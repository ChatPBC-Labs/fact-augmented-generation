from __future__ import annotations

import re
from collections import defaultdict

from .documents import Fact

_SHINGLE = 5


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def _shingles(text: str) -> set[str]:
    norm = _norm(text)
    if len(norm) <= _SHINGLE:
        return {norm} if norm else set()
    return {norm[i : i + _SHINGLE] for i in range(len(norm) - _SHINGLE + 1)}


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    if inter == 0:
        return 0.0
    return inter / (len(a) + len(b) - inter)


def _bucket_key(fact: Fact) -> str:
    words = _norm(fact.text).split()
    return " ".join(words[:4]) if words else ""


def fact_key(fact: Fact) -> str:
    return f"{fact.source_url}||{_norm(fact.text)}"


def normalize_facts(
    facts: list[Fact],
    threshold: float = 0.85,
    max_per_source: int | None = None,
    min_importance: int = 1,
) -> list[Fact]:
    eligible = [f for f in facts if f.importance >= min_importance]
    buckets: dict[str, list[Fact]] = defaultdict(list)
    for fact in eligible:
        buckets[_bucket_key(fact)].append(fact)

    kept: list[Fact] = []
    shingle_cache: dict[int, set[str]] = {}
    for fact in eligible:
        fid = id(fact)
        sh = shingle_cache.setdefault(fid, _shingles(fact.text))
        duplicate = False
        key = _bucket_key(fact)
        for other in buckets[key]:
            if other is fact:
                continue
            other_sh = shingle_cache.setdefault(id(other), _shingles(other.text))
            if jaccard(sh, other_sh) >= threshold:
                if (other.importance, other.text) > (fact.importance, fact.text):
                    duplicate = True
                    break
                if (other.importance, other.text) == (fact.importance, fact.text) and any(
                    o is other for o in kept
                ):
                    duplicate = True
                    break
        if not duplicate:
            kept.append(fact)

    kept.sort(key=lambda f: (-f.importance, f.text))
    if max_per_source is not None:
        per_source: dict[str, int] = {}
        limited: list[Fact] = []
        for fact in kept:
            count = per_source.get(fact.source_url, 0)
            if count < max_per_source:
                limited.append(fact)
                per_source[fact.source_url] = count + 1
        kept = limited
    return kept
