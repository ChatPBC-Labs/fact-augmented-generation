"""factag ? Fact-Augmented Generation.

RAG-shaped pipeline: load ? split ? extract ? normalize ? store ? assemble.
Pure standard library. Zero keys required (HeuristicExtractor default).
"""

from .documents import Document, Fact, Metadata, source_url_of
from .extractors import Extractor, HeuristicExtractor, LLMExtractor, parse_fact_json, DEFAULT_LLM_SYSTEM_PROMPT
from .loaders import (
    BaseLoader,
    DirectoryLoader,
    TextLoader,
    URLLoader,
    SitemapLoader,
    html_to_text,
    looks_like_html,
)
from .normalize import normalize_facts
from .pipeline import IngestionPipeline, IngestResult
from .retrievers import (
    FACTS_FOOTER,
    FACTS_HEADER,
    BudgetAssembler,
    KeywordRetriever,
    fact_line,
    to_context_block,
)
from .splitter import RecursiveHeadingSplitter, DEFAULT_SEPARATORS
from .stores import FileFactStore, MemoryFactStore
from .watcher import (
    PollResult,
    WatchEvent,
    WatchSession,
    normalize_source,
    poll_source,
    stable_hash,
)

VERSION = "0.1.4"

__all__ = [
    "Document",
    "Fact",
    "Metadata",
    "source_url_of",
    "Extractor",
    "HeuristicExtractor",
    "LLMExtractor",
    "parse_fact_json",
    "DEFAULT_LLM_SYSTEM_PROMPT",
    "BaseLoader",
    "DirectoryLoader",
    "TextLoader",
    "URLLoader",
    "SitemapLoader",
    "html_to_text",
    "looks_like_html",
    "normalize_facts",
    "IngestionPipeline",
    "IngestResult",
    "FACTS_HEADER",
    "FACTS_FOOTER",
    "BudgetAssembler",
    "KeywordRetriever",
    "fact_line",
    "to_context_block",
    "RecursiveHeadingSplitter",
    "DEFAULT_SEPARATORS",
    "FileFactStore",
    "MemoryFactStore",
    "poll_source",
    "stable_hash",
    "normalize_source",
    "WatchSession",
    "WatchEvent",
    "PollResult",
    "VERSION",
]

