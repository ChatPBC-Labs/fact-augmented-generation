from __future__ import annotations

import asyncio
import hashlib
from dataclasses import dataclass, field
from typing import Callable

from .documents import Document, Fact
from .extractors import Extractor, HeuristicExtractor
from .loaders import BaseLoader, DirectoryLoader, SitemapLoader, URLLoader
from .normalize import fact_key
from .pipeline import IngestionPipeline
from .splitter import RecursiveHeadingSplitter
from .stores import FactStore, MemoryFactStore

FACTS_HEADER = "=== VERIFIED FACTS ==="


def stable_hash(text: str) -> str:
    norm = " ".join(text.split()).strip()
    return hashlib.sha1(norm.encode("utf-8")).hexdigest()[:12]


def normalize_source(source: str | tuple):
    if isinstance(source, str):
        if source.startswith("http://") or source.startswith("https://"):
            if source.endswith("sitemap.xml"):
                return ("sitemap", source)
            return ("url", source)
        return ("dir", source)
    return source


def loader_for(source: tuple, headers: dict | None = None) -> BaseLoader:
    kind, value = source
    if kind == "url":
        return URLLoader(value, headers=headers)
    if kind == "sitemap":
        return SitemapLoader(value, headers=headers)
    return DirectoryLoader(value)


@dataclass
class PollResult:
    changed: bool
    hash: str
    added: int = 0
    kept: int = 0
    skipped_from_store: int = 0
    removed_candidates: list[Fact] = field(default_factory=list)
    pruned: int = 0
    ingest_result: object = None


async def poll_source(
    source: str | tuple,
    store: FactStore,
    extractor: Extractor | None = None,
    splitter: RecursiveHeadingSplitter | None = None,
    last_hash: str | None = None,
    prune_stale: bool = False,
    dedupe_across_runs: bool = True,
    headers: dict | None = None,
) -> PollResult:
    """One monitoring pass: fetch, hash, and (on change) re-ingest and report stale facts.

    headers: extra fetch headers — e.g. a browser user-agent for sites that block
    non-browser bots ({"user-agent": "Mozilla/5.0 ..."}).
    """
    src = normalize_source(source)
    splitter = splitter or RecursiveHeadingSplitter()
    extractor = extractor or HeuristicExtractor()
    loop = asyncio.get_running_loop()

    docs = await loop.run_in_executor(None, loader_for(src, headers).load)
    digest = stable_hash("\x00".join(d.page_content for d in docs))
    if last_hash is not None and last_hash == digest:
        return PollResult(changed=False, hash=digest)

    pipeline = IngestionPipeline(loader=loader_for(src, headers), extractor=extractor, splitter=splitter, store=store)
    pipeline.dedupe_across_runs = dedupe_across_runs
    result = await pipeline.run()

    doc_sources: set[str] = set()
    for d in docs:
        srcval = d.metadata.get("source") or d.metadata.get("url")
        if srcval:
            doc_sources.add(str(srcval))

    fresh_docs = await loop.run_in_executor(None, loader_for(src, headers).load)
    fresh_chunks: list[Document] = []
    for doc in fresh_docs:
        for piece in splitter.split_text(doc.page_content):
            fresh_chunks.append(Document(page_content=piece, metadata=dict(doc.metadata)))
    fresh: list[Fact] = []
    for chunk in fresh_chunks:
        fresh.extend(await loop.run_in_executor(None, extractor.extract, chunk))
    fresh_keys = {fact_key(fact) for fact in fresh}

    current = [f for f in store.all() if f.source_url in doc_sources]
    removed = [f for f in current if fact_key(f) not in fresh_keys]
    pruned = 0
    if prune_stale and removed:
        stale_keys = {fact_key(f) for f in removed}
        pruned = store.remove_where(lambda f: fact_key(f) in stale_keys)

    return PollResult(
        changed=True,
        hash=digest,
        added=result.kept,
        kept=result.kept,
        skipped_from_store=result.stats.get("skippedFromStore", 0),
        removed_candidates=removed,
        pruned=pruned,
        ingest_result=result,
    )


@dataclass
class WatchEvent:
    kind: str  # "change" | "nochange" | "error"
    hash: str | None = None
    result: PollResult | None = None
    error: Exception | None = None


class WatchSession:
    """Poll a source on an interval until stopped. Passes never overlap."""

    def __init__(
        self,
        source: str | tuple,
        store: FactStore,
        interval_seconds: float = 300,
        extractor: Extractor | None = None,
        splitter: RecursiveHeadingSplitter | None = None,
        prune_stale: bool = False,
        on_event: Callable[[WatchEvent], None] | None = None,
        headers: dict | None = None,
    ) -> None:
        if interval_seconds < 5:
            raise ValueError("interval_seconds must be >= 5 (be kind to the websites you monitor)")
        self.source = source
        self.store = store
        self.interval = interval_seconds
        self.extractor = extractor
        self.splitter = splitter or RecursiveHeadingSplitter()
        self.prune_stale = prune_stale
        self.on_event = on_event
        self.headers = headers
        self.stopped = False
        self._last_hash: str | None = None
        self._task: asyncio.Task | None = None

    def _emit(self, event: WatchEvent) -> None:
        if self.on_event:
            self.on_event(event)

    async def tick(self) -> WatchEvent:
        try:
            result = await poll_source(
                self.source,
                self.store,
                extractor=self.extractor,
                splitter=self.splitter,
                last_hash=self._last_hash,
                prune_stale=self.prune_stale,
                headers=self.headers,
            )
            if result.changed:
                self._last_hash = result.hash
                event = WatchEvent(kind="change", hash=result.hash, result=result)
            else:
                event = WatchEvent(kind="nochange", hash=result.hash)
            self._emit(event)
            return event
        except Exception as exc:  # noqa: BLE001 - watcher must never crash the loop
            event = WatchEvent(kind="error", error=exc)
            self._emit(event)
            return event

    async def _loop(self) -> None:
        while not self.stopped:
            await self.tick()
            await asyncio.sleep(self.interval)

    def start(self) -> None:
        if self.stopped:
            raise RuntimeError("session already stopped")
        self._task = asyncio.get_running_loop().create_task(self._loop())

    def stop(self) -> None:
        self.stopped = True
        if self._task is not None:
            self._task.cancel()
            self._task = None
