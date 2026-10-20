from __future__ import annotations

import re
from abc import ABC, abstractmethod

from .documents import Document, Metadata, source_url_of

FACTAG_USER_AGENT = "FactAugmentedGeneration/0.1 (+https://github.com/factag-generator/factag)"

_NAMED = {
    "amp": "&", "lt": "<", "gt": ">", "quot": '"', "apos": "'", "nbsp": " ",
    "ndash": "–", "mdash": "—", "hellip": "…", "copy": "©", "reg": "®",
    "trade": "™", "euro": "€", "pound": "£", "yen": "¥", "middot": "·", "bull": "•",
}

_DROP_ALWAYS = re.compile(
    r"<(script|style|head|title|noscript|template|svg|iframe|canvas|form|button|select|textarea)[^>]*>[\s\S]*?</\1\s*>",
    re.I,
)
_DROP_ALWAYS_SELF = re.compile(r"<(hr|br|img|input|meta|link|source|track|wbr|col)\b[^>]*\/?>", re.I)
_DROP_CHROME = re.compile(r"<(nav|footer|aside|header|dialog|menu)[^>]*>[\s\S]*?</\1\s*>", re.I)
_COMMENTS = re.compile(r"<!--[\s\S]*?-->")
_HEADING_OPEN = re.compile(r"<h([1-6])[^>]*>", re.I)
_HEADING_CLOSE = re.compile(r"</h[1-6]\s*>", re.I)
_LI_OPEN = re.compile(r"<li[^>]*>", re.I)
_BLOCK_CLOSE = re.compile(r"</(p|div|section|article|ul|ol|table|tbody|thead|tr|blockquote|pre|figure|figcaption|details|summary|dl|dt|dd)\s*>", re.I)
_BLOCK_OPEN = re.compile(
    r"<(p|div|section|article|ul|ol|table|tbody|thead|tr|blockquote|pre|figure|figcaption|details|summary|dl|dt|dd|td|th|caption)\b[^>]*>",
    re.I,
)
_ANY_TAG = re.compile(r"<[^>]+>")
_TITLE = re.compile(r"<title[^>]*>([\s\S]*?)</title>", re.I)


def decode_entities(text: str) -> str:
    def hex_sub(m: re.Match[str]) -> str:
        return chr(int(m.group(1), 16))

    def dec_sub(m: re.Match[str]) -> str:
        return chr(int(m.group(1)))

    def name_sub(m: re.Match[str]) -> str:
        return _NAMED.get(m.group(1).lower(), m.group(0))

    text = re.sub(r"&#x([0-9a-f]+);", hex_sub, text, flags=re.I)
    text = re.sub(r"&#(\d+);", dec_sub, text)
    return re.sub(r"&([a-z]+);", name_sub, text, flags=re.I)


def extract_title(html: str) -> str:
    m = _TITLE.search(html)
    return re.sub(r"\s+", " ", decode_entities(m.group(1))).strip() if m else ""


def html_to_text(html: str, remove_chrome: bool = True) -> str:
    out = _COMMENTS.sub("", html)
    out = _DROP_ALWAYS.sub("", out)
    out = _DROP_ALWAYS_SELF.sub(" ", out)
    if remove_chrome:
        out = _DROP_CHROME.sub("", out)
    out = _HEADING_OPEN.sub(lambda m: "\n" + "#" * int(m.group(1)) + " ", out)
    out = _HEADING_CLOSE.sub("\n", out)
    out = _LI_OPEN.sub("\n- ", out)
    out = _BLOCK_CLOSE.sub("\n", out)
    out = _BLOCK_OPEN.sub("\n", out)
    out = re.sub(r"<br\s*/?>", "\n", out, flags=re.I)
    out = _ANY_TAG.sub("", out)
    out = out.replace("&nbsp;", " ")
    out = decode_entities(out)
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in out.split("\n")]
    out = "\n".join(lines)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()


def looks_like_html(content_type: str | None, sample: str) -> bool:
    ct = (content_type or "").lower()
    if "html" in ct or "xhtml" in ct:
        return True
    if "markdown" in ct or "text/plain" in ct:
        return False
    return bool(re.match(r"\s*(<!doctype html|<html|<head|<body|<h1|<div|<p>)", sample, re.I))


class BaseLoader(ABC):
    @abstractmethod
    def load(self) -> list[Document]:
        raise NotImplementedError


def _fetch(url: str, timeout: float = 15.0, headers: dict | None = None) -> tuple[bytes, str | None]:
    import urllib.request

    merged = {"user-agent": FACTAG_USER_AGENT, **(headers or {})}
    req = urllib.request.Request(url, headers=merged)
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
        return resp.read(), resp.headers.get("content-type")


class TextLoader(BaseLoader):
    def __init__(self, content: str, metadata: Metadata | None = None, fmt: str = "auto") -> None:
        self.content = content
        self.metadata = metadata or {}
        self.fmt = fmt

    def load(self) -> list[Document]:
        is_html = self.fmt == "html" or (
            self.fmt == "auto" and looks_like_html(None, self.content[:1000])
        )
        text = html_to_text(self.content) if is_html else self.content.strip()
        meta: Metadata = {"source": "inline", "url": "inline", **self.metadata}
        return [Document(page_content=text, metadata=meta)]


class URLLoader(BaseLoader):
    def __init__(self, url: str, metadata: Metadata | None = None, timeout: float = 15.0, headers: dict | None = None) -> None:
        self.url = url
        self.metadata = metadata or {}
        self.timeout = timeout
        self.headers = headers

    def load(self) -> list[Document]:
        body_bytes, content_type = _fetch(self.url, self.timeout, self.headers)
        body = body_bytes.decode("utf-8", errors="replace")
        meta: Metadata = {"source": self.url, "url": self.url, **self.metadata}
        if looks_like_html(content_type, body[:500]):
            title = extract_title(body)
            if title:
                meta["title"] = title
            return [Document(page_content=html_to_text(body), metadata=meta)]
        return [Document(page_content=body.strip(), metadata=meta)]


class SitemapLoader(BaseLoader):
    def __init__(self, sitemap_url: str, max_pages: int = 50, timeout: float = 15.0, headers: dict | None = None) -> None:
        self.sitemap_url = sitemap_url
        self.max_pages = max_pages
        self.timeout = timeout
        self.headers = headers

    def _discover(self, url: str, depth: int = 0) -> list[str]:
        body_bytes, _ = _fetch(url, self.timeout, self.headers)
        xml = body_bytes.decode("utf-8", errors="replace")
        locs = [m.strip() for m in re.findall(r"<loc>\s*([\s\S]*?)\s*</loc>", xml, re.I)]
        if re.search(r"<sitemapindex[\s>]", xml, re.I) and depth < 2:
            out: list[str] = []
            for child in locs[:20]:
                try:
                    out.extend(self._discover(child, depth + 1))
                except Exception:
                    continue
            return out
        return locs

    def load(self) -> list[Document]:
        found = self._discover(self.sitemap_url)
        urls = list(dict.fromkeys(u for u in found if re.match(r"^https?://", u, re.I)))[: self.max_pages]
        docs: list[Document] = []
        for url in urls:
            try:
                docs.extend(URLLoader(url, timeout=self.timeout, headers=self.headers).load())
            except Exception:
                continue
        return docs


class DirectoryLoader(BaseLoader):
    def __init__(
        self,
        dir_path: str,
        extensions: list[str] | None = None,
        recursive: bool = True,
        max_files: int = 500,
        metadata: Metadata | None = None,
    ) -> None:
        self.dir_path = dir_path
        self.extensions = [e.lower() for e in (extensions or [".md", ".markdown", ".txt", ".html", ".htm"])]
        self.recursive = recursive
        self.max_files = max_files
        self.metadata = metadata or {}

    def _walk(self, root: str) -> list[str]:
        import os

        out: list[str] = []
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            for name in filenames:
                out.append(os.path.join(dirpath, name))
                if len(out) >= self.max_files:
                    return out
            if not self.recursive:
                break
        return out

    def load(self) -> list[Document]:
        import os
        import pathlib

        target = os.path.abspath(self.dir_path)
        if os.path.isfile(target):
            files = [target]
        else:
            files = self._walk(target)
        docs: list[Document] = []
        for path in files:
            ext = os.path.splitext(path)[1].lower()
            if ext not in self.extensions:
                continue
            raw = pathlib.Path(path).read_text(encoding="utf-8", errors="replace")
            content = html_to_text(raw) if ext in (".html", ".htm") else raw.strip()
            if not content:
                continue
            file_url = pathlib.Path(path).as_uri()
            meta: Metadata = {
                "source": file_url,
                "url": file_url,
                "title": os.path.basename(path),
                **self.metadata,
            }
            docs.append(Document(page_content=content, metadata=meta))
        return docs


def source_url_of_doc(doc: Document) -> str:
    return source_url_of(doc)
