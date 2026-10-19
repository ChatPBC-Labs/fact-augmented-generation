from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, Callable

from .documents import Document, Fact
from .extractors import Extractor, HeuristicExtractor
from .loaders import BaseLoader
from .normalize import fact_key, normalize_facts
from .splitter import RecursiveHeadingSplitter
from .stores import MemoryFactStore


@dataclass
class IngestResult:
    documents: int = 0
    chunks: int = 0
    raw: int = 0
    kept: int = 0
    stats: dict[str, Any] = field(default_factory=dict)


@dataclass
class IngestionPipeline:
    """load → split → extract → normalize → store (LlamaIndex-style .run())."""

    loader: BaseLoader
    extractor: Extractor = field(default_factory=HeuristicExtractor)
    splitter: RecursiveHeadingSplitter | None = None
    store: MemoryFactStore | None = None
    normalize: bool = True
    dedupe_across_runs: bool = True
    on_progress: Callable[[str], None] | None = None

    def _progress(self, message: str) -> None:
        if self.on_progress:
            self.on_progress(message)

    async def run(self) -> IngestResult:
        loop = asyncio.get_running_loop()
        self._progress("load")
        docs = await loop.run_in_executor(None, self.loader.load)
        result = IngestResult(documents=len(docs))

        chunks: list[Document] = []
        if self.splitter is not None:
            self._progress("split")
            for doc in docs:
                pieces = self.splitter.split_text(doc.page_content)
                for i, piece in enumerate(pieces):
                    meta = {**doc.metadata, "chunkIndex": i, "chunkId": f"{i}:::{piece[:24]}"}
                    chunks.append(Document(page_content=piece, metadata=meta))
        else:
            chunks = docs
        result.chunks = len(chunks)

        self._progress("extract")
        raw_facts: list[Fact] = []
        for chunk in chunks:
            raw_facts.extend(await loop.run_in_executor(None, self.extractor.extract, chunk))
        result.raw = len(raw_facts)

        self._progress("normalize")
        kept = normalize_facts(raw_facts) if self.normalize else raw_facts

        store = self.store if self.store is not None else MemoryFactStore()
        skipped_from_store = 0
        if self.dedupe_across_runs:
            existing = store.all()
            seen = {fact_key(f) for f in existing}
            fresh: list[Fact] = []
            for fact in kept:
                key = fact_key(fact)
                if key in seen:
                    skipped_from_store += 1
                    continue
                seen.add(key)
                fresh.append(fact)
            kept = fresh
        result.kept = len(kept)

        self._progress("store")
        await loop.run_in_executor(None, store.add, kept)
        result.stats["store"] = type(store).__name__
        result.stats["skippedFromStore"] = skipped_from_store
        return result
