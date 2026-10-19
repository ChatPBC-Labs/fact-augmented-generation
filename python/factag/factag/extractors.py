from __future__ import annotations

import json
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Protocol

from .documents import Document, Fact, Metadata, source_url_of

DEFAULT_LLM_SYSTEM_PROMPT = (
    "You are a fact extraction engine. Extract atomic, verifiable, self-contained facts from the text. "
    "Return ONLY a JSON array. Each element: "
    '{"text": "...", "importance": 1-5, "category": "pricing|feature|limit|contact|policy|api|fact|date|entity|other"}. '
    "Never invent facts. Never merge facts from different sentences. "
    "Importance: 5 = must-have core fact, 3 = useful detail, 1 = trivia."
)

_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'\(])|\n+")


class Extractor(Protocol):
    def extract(self, doc: Document) -> list[Fact]: ...


def coerce_importance(value: Any) -> int:
    try:
        v = int(value)
    except (TypeError, ValueError):
        return 3
    return max(1, min(5, v))


def parse_fact_json(raw: str, doc: Document, chunk_index: int = 0) -> list[Fact]:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    m = re.search(r"\[[\s\S]*\]", text)
    if m:
        text = m.group(0)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    url = source_url_of(doc)
    out: list[Fact] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        ftext = str(item.get("text", "")).strip()
        if not ftext:
            continue
        out.append(
            Fact(
                text=ftext,
                importance=coerce_importance(item.get("importance")),
                category=str(item.get("category", "fact")).strip().lower() or "fact",
                source_url=url,
                chunk_id=f"{chunk_index}:::{ftext[:24]}",
                metadata={"title": doc.metadata["title"]} if doc.metadata.get("title") else {},
            )
        )
    return out


@dataclass
class HeuristicExtractor:
    """Zero-key extractor: rule-based importance + category guess from the raw text."""

    min_importance: int = 1
    rules: list[tuple[int, re.Pattern[str]]] = field(
        default_factory=lambda: [
            (4, re.compile(r"\$\s?\d|\b\d+(\.\d+)?\s?(usd|eur|gbp|mb|gb|ms|s|rpm|tpm)\b|per month|per year|/mo|/yr", re.I)),
            (3, re.compile(r"\b\d+(\.\d+)?%|\bfree\b|\bunlimited\b|\b\d+\s?(api|key|seat|user|request|token)", re.I)),
            (2, re.compile(r"\bmust|required|requires|always|never|only|guarantee|warranty|support(ed)?\b", re.I)),
            (2, re.compile(r"\b(https?://|www\.)\S+|[\w.+-]+@[\w-]+\.[a-z]{2,}", re.I)),
            (1, re.compile(r"\b(available|launch(ed)?|founded|released|version)\b", re.I)),
            (1, re.compile(r"\b\d+(\.\d+)?\b")),
        ]
    )

    def _guess_category(self, text: str) -> str:
        t = text.lower()
        if re.search(r"\$|price|cost|plan|billing|invoice|[¥€£]", t):
            return "pricing"
        if re.search(r"@[\w.-]+|email|phone|address|contact", t):
            return "contact"
        if re.search(r"\b\d+\s?(rpm|tpm|qps|limit|quota|max|requests? per)\b", t):
            return "limit"
        if re.search(r"https?://|api|endpoint|sdk|library", t):
            return "api"
        if re.search(r"feature|dashboard|supports?|includes?", t):
            return "feature"
        if re.search(r"privacy|gdpr|terms|policy|retention", t):
            return "policy"
        if re.search(r"\d{4}-\d{2}-\d{2}|\b(19|20)\d{2}\b", t):
            return "date"
        return "fact"

    def extract(self, doc: Document) -> list[Fact]:
        url = source_url_of(doc)
        out: list[Fact] = []
        seen: set[str] = set()
        for sentence in _SENT_SPLIT.split(doc.page_content):
            s = sentence.strip()
            if len(s) < 12:
                continue
            score = 0
            for weight, pattern in self.rules:
                if pattern.search(s):
                    score += weight
            if score == 0:
                continue
            importance = max(self.min_importance, (score + 3) // 2)
            key = re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()[:120]
            if key in seen:
                continue
            seen.add(key)
            out.append(
                Fact(
                    text=s,
                    importance=min(5, importance),
                    category=self._guess_category(s),
                    source_url=url,
                    chunk_id=f"0:::{key[:24]}",
                    metadata={"title": doc.metadata["title"]} if doc.metadata.get("title") else {},
                )
            )
        return out


@dataclass
class LLMExtractor:
    """OpenAI-compatible /chat/completions extractor. Requires api_key + base_url."""

    api_key: str
    base_url: str
    model: str = "gpt-4o-mini"
    system_prompt: str = DEFAULT_LLM_SYSTEM_PROMPT
    batch_size: int = 6
    concurrency: int = 3
    timeout: float = 60.0
    max_retries: int = 3
    temperature: float = 0.0
    chunk_char_budget: int = 6000

    def _call(self, texts: list[str]) -> list[Fact]:
        joined = "\n\n".join(f"[chunk {i}]\n{t}" for i, t in enumerate(texts))
        payload = json.dumps(
            {
                "model": self.model,
                "temperature": self.temperature,
                "messages": [
                    {"role": "system", "content": self.system_prompt},
                    {"role": "user", "content": f"Extract facts:\n\n{joined[: self.chunk_char_budget]}"},
                ],
            }
        ).encode("utf-8")
        url = self.base_url.rstrip("/") + "/chat/completions"
        last_err: Exception | None = None
        for attempt in range(self.max_retries):
            req = urllib.request.Request(
                url,
                data=payload,
                headers={"content-type": "application/json", "authorization": f"Bearer {self.api_key}"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:  # noqa: S310
                    data = json.loads(resp.read().decode("utf-8"))
                content = data["choices"][0]["message"]["content"]
                return parse_fact_json(content, Document(page_content=joined), 0)
            except Exception as exc:  # noqa: BLE001
                last_err = exc
                if attempt < self.max_retries - 1:
                    import time

                    time.sleep(2**attempt)
                    continue
                break
        raise RuntimeError(f"LLM extraction failed: {last_err}")

    def extract(self, doc: Document) -> list[Fact]:
        text = doc.page_content
        slices: list[str] = []
        start = 0
        while start < len(text):
            end = min(len(text), start + self.chunk_char_budget)
            if end < len(text):
                nl = text.rfind("\n", start, end)
                if nl > start + self.chunk_char_budget // 2:
                    end = nl
            slices.append(text[start:end])
            start = end
        all_facts: list[Fact] = []
        with ThreadPoolExecutor(max_workers=self.concurrency) as pool:
            for batch_facts in pool.map(self._call_slices, [slices[i : i + self.batch_size] for i in range(0, len(slices), self.batch_size)]):
                all_facts.extend(batch_facts)
        url = source_url_of(doc)
        for i, fact in enumerate(all_facts):
            fact.source_url = url
            fact.chunk_id = fact.chunk_id or f"{i}:::{fact.text[:24]}"
        return all_facts

    def _call_slices(self, batch: list[str]) -> list[Fact]:
        return self._call(batch)


def chunks_of(text: str, size: int = 2000) -> list[str]:
    return [text[i : i + size] for i in range(0, len(text), size)] or [text]
