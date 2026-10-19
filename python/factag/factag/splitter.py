from __future__ import annotations

import re

from .documents import Document, Metadata, source_url_of

DEFAULT_SEPARATORS = [
    "\n## ",
    "\n### ",
    "\n# ",
    "\n\n",
    "\n",
    ". ",
    " ",
    "",
]

_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")


def _heading_level(text: str) -> int:
    m = _HEADING.match(text.strip())
    return len(m.group(1)) if m else 0


class RecursiveHeadingSplitter:
    """Split text on headings first, then fall back to paragraph/sentence/character
    boundaries — the FACT recursive splitter with heading awareness."""

    def __init__(
        self,
        chunk_size: int = 1000,
        chunk_overlap: int = 200,
        separators: list[str] | None = None,
        keep_heading: bool = True,
    ) -> None:
        if chunk_overlap >= chunk_size:
            raise ValueError("chunk_overlap must be smaller than chunk_size")
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.separators = separators if separators is not None else list(DEFAULT_SEPARATORS)
        self.keep_heading = keep_heading

    def split_text(self, text: str) -> list[str]:
        chunks = self._split(text, 0, [])
        out: list[str] = []
        for piece in chunks:
            piece = piece.strip()
            if not piece:
                continue
            if len(piece) <= self.chunk_size:
                out.append(piece)
            else:
                start = 0
                while start < len(piece):
                    out.append(piece[start : start + self.chunk_size].strip())
                    if start + self.chunk_size >= len(piece):
                        break
                    start += self.chunk_size - self.chunk_overlap
        return [c for c in out if c]

    def _split(self, text: str, sep_index: int, heading_path: list[str]) -> list[str]:
        text = text.strip("\n")
        if not text:
            return []
        if len(text) <= self.chunk_size and sep_index >= len(self.separators):
            return [text]
        if len(text) <= self.chunk_size and self._no_heading_overwrite(text, heading_path):
            return [text]

        if sep_index < 2:
            # heading separators: split at heading boundaries, tracking path
            sep = self.separators[sep_index]
            parts = text.split(sep) if sep in text else []
            if len(parts) > 1:
                out: list[str] = []
                current_path = list(heading_path)
                for i, part in enumerate(parts):
                    segment = part if i == 0 else sep + part
                    lines = segment.lstrip().split("\n")
                    head = lines[0].strip() if lines else ""
                    level = _heading_level(head) if i > 0 else _heading_level(head)
                    title = head.lstrip("# ").strip() if level else ""
                    if level:
                        current_path = [p for p in current_path if _heading_rank(p) < level]
                        if title:
                            current_path = current_path + [f"{level}:{title}"]
                    out.extend(self._split(segment, sep_index + 1, current_path))
                return out

        if sep_index >= len(self.separators):
            return [text]

        sep = self.separators[sep_index]
        if sep == "":
            return [text[i : i + self.chunk_size] for i in range(0, len(text), self.chunk_size)]
        if sep not in text:
            return self._split(text, sep_index + 1, heading_path)

        pieces = text.split(sep)
        merged: list[str] = []
        buf = ""
        for piece in pieces:
            cand = buf + piece if buf else piece
            if len(cand) <= self.chunk_size or not buf:
                buf = cand
            else:
                merged.append(buf)
                buf = piece
        if buf:
            merged.append(buf)
        return [m for m in merged if m]

    def _no_heading_overwrite(self, text: str, _path: list[str]) -> bool:
        return "\n#" not in "\n" + text or _heading_level(text.split("\n")[0]) > 0

    def create_documents(self, texts: list[str], metadatas: list[Metadata] | None = None) -> list[Document]:
        docs: list[Document] = []
        for i, text in enumerate(texts):
            meta = dict(metadatas[i]) if metadatas and i < len(metadatas) else {}
            path = self._heading_path(text)
            for j, chunk in enumerate(self.split_text(text)):
                m: Metadata = {
                    **meta,
                    "sourceUrl": source_url_of(Document(text, meta)) if meta else meta.get("sourceUrl", "unknown"),
                    "chunkIndex": j,
                    "chunkId": f"{j}:::{chunk[:24]}",
                }
                if path:
                    m["headingPath"] = path
                docs.append(Document(page_content=chunk, metadata=m))
        return docs

    @staticmethod
    def _heading_path(text: str) -> str:
        path: list[str] = []
        for line in text.split("\n")[:20]:
            level = _heading_level(line)
            if level:
                title = line.strip().lstrip("# ").strip()
                path = [p for p in path if _rank_str(p) < level] + [f"{'#' * level} {title}"]
        return " > ".join(path)


def _heading_rank(level_line_title: str) -> int:
    return int(level_line_title.split(":", 1)[0]) if ":" in level_line_title else 0


def _rank_str(entry: str) -> int:
    return len(entry) - len(entry.lstrip("#"))
