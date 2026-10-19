from __future__ import annotations

import re
from typing import Protocol

from .documents import Fact

FACTS_HEADER = "=== VERIFIED FACTS ==="
FACTS_FOOTER = "=== END VERIFIED FACTS ==="

_STOPWORDS = {
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "was",
    "were", "be", "it", "this", "that", "with", "as", "at", "by", "from", "has", "have",
    "what", "which", "how", "does", "do", "can", "you", "your",
}

_TOKEN = re.compile(r"[a-z0-9]+")


def tokenize(text: str) -> list[str]:
    return [t for t in _TOKEN.findall(text.lower()) if t not in _STOPWORDS]


def fact_line(fact: Fact) -> str:
    return f"- ({fact.source_url}) importance={fact.importance} category={fact.category} {fact.text}"


def to_context_block(facts: list[Fact]) -> str:
    if not facts:
        return ""
    lines = [FACTS_HEADER] + [fact_line(f) for f in facts] + ["", FACTS_FOOTER]
    return "\n".join(lines)


class FactSource(Protocol):
    def all(self) -> list[Fact]: ...


class AssemblerOptions(Protocol):
    budget: int


class BudgetAssembler:
    """Pack whole facts (never partial) into the budget, importance first."""

    def __init__(self, source: FactSource, budget: int = 8000) -> None:
        self.source = source
        self.budget = budget

    async def assemble(self, query: str = "", k: int | None = None) -> tuple[list[Fact], list[Fact]]:
        all_facts = sorted(self.source.all(), key=lambda f: -f.importance)
        facts = all_facts
        if k is not None and k > 0:
            facts = sorted(top_k_by_query(all_facts, query or "", k), key=lambda f: -f.importance)
        budget = self.budget - len(FACTS_HEADER) - len(FACTS_FOOTER) - 4
        included: list[Fact] = []
        used = 0
        omitted: list[Fact] = []
        for fact in facts:
            line_len = len(fact_line(fact)) + 1
            if used + line_len <= budget:
                included.append(fact)
                used += line_len
            else:
                omitted.append(fact)
        return included, omitted

    async def invoke(self, query: str = "", k: int | None = None) -> list[Fact]:
        included, _ = await self.assemble(query, k)
        return included

    async def to_context(self, query: str = "", k: int | None = None) -> str:
        included, _ = await self.assemble(query, k)
        return to_context_block(included)


def top_k_by_query(facts: list[Fact], query: str, k: int) -> list[Fact]:
    if k <= 0 or not facts:
        return []
    q_tokens = set(tokenize(query))
    if not q_tokens:
        return sorted(facts, key=lambda f: -f.importance)[:k]
    scored: list[tuple[int, int, Fact]] = []
    for index, fact in enumerate(facts):
        tokens = set(tokenize(fact.text))
        overlap = len(q_tokens & tokens)
        if overlap:
            scored.append((overlap, index, fact))
    scored.sort(key=lambda s: (-s[0], -s[2].importance, s[1]))
    return [f for _, _, f in scored[:k]][:k]


class KeywordRetriever:
    """Lexical fallback: score facts by shared tokens with the query."""

    def __init__(self, source: FactSource, k: int = 4) -> None:
        self.source = source
        self.k = k

    async def invoke(self, query: str) -> list[Fact]:
        return top_k_by_query(self.source.all(), query, self.k)
