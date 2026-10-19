from __future__ import annotations

import json
import os
import pathlib
from typing import Protocol

from .documents import Fact


class FactStore(Protocol):
    async def all(self) -> list[Fact]: ...


class MemoryFactStore:
    def __init__(self, facts: list[Fact] | None = None) -> None:
        self._facts: list[Fact] = list(facts or [])

    @classmethod
    def from_documents(cls, facts: list[Fact]) -> "MemoryFactStore":
        return cls(facts)

    def add(self, facts: list[Fact]) -> None:
        self._facts.extend(facts)

    def all(self) -> list[Fact]:
        return list(self._facts)

    def __len__(self) -> int:
        return len(self._facts)


class FileFactStore:
    """JSONL-backed store — same on-disk format as the TypeScript implementation."""

    def __init__(self, path: str) -> None:
        self.path = path
        self._facts: list[Fact] | None = None
        self._header: dict | None = None

    def _load(self) -> None:
        if self._facts is not None:
            return
        self._facts = []
        p = pathlib.Path(self.path)
        if not p.exists():
            return
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(data, dict) and data.get("_type") == "fag-store":
                self._header = data
                continue
            self._facts.append(Fact.from_wire(data))

    def add(self, facts: list[Fact]) -> None:
        self._load()
        assert self._facts is not None
        self._facts.extend(facts)

    def all(self) -> list[Fact]:
        self._load()
        assert self._facts is not None
        return list(self._facts)

    def flush(self) -> None:
        self._load()
        assert self._facts is not None
        p = pathlib.Path(self.path)
        if p.parent and not p.parent.exists():
            os.makedirs(p.parent, exist_ok=True)
        lines = [json.dumps({"_type": "fag-store", "version": 1}, separators=(",", ":"))]
        lines += [json.dumps(f.to_wire(), ensure_ascii=False) for f in self._facts]
        p.write_text("\n".join(lines) + "\n", encoding="utf-8")

    def __len__(self) -> int:
        self._load()
        assert self._facts is not None
        return len(self._facts)
