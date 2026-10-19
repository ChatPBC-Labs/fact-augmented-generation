from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

Metadata = dict[str, Any]


@dataclass
class Document:
    page_content: str
    metadata: Metadata = field(default_factory=dict)


@dataclass
class Fact:
    text: str
    importance: int
    category: str
    source_url: str
    chunk_id: str | None = None
    metadata: Metadata = field(default_factory=dict)

    def to_wire(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "text": self.text,
            "importance": self.importance,
            "category": self.category,
            "sourceUrl": self.source_url,
        }
        if self.chunk_id:
            out["chunkId"] = self.chunk_id
        if self.metadata:
            out["metadata"] = self.metadata
        return out

    @staticmethod
    def from_wire(data: dict[str, Any]) -> "Fact":
        return Fact(
            text=str(data.get("text", "")),
            importance=int(data.get("importance", 3)),
            category=str(data.get("category", "fact")),
            source_url=str(data.get("sourceUrl", "unknown")),
            chunk_id=data.get("chunkId"),
            metadata=data.get("metadata") or {},
        )


def source_url_of(doc: Document) -> str:
    raw = doc.metadata.get("url") or doc.metadata.get("source")
    if isinstance(raw, str) and raw:
        return raw
    return "unknown"
