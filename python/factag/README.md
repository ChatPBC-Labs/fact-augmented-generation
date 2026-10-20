# factag (Python)

Python twin of the TypeScript [`factag`](https://www.npmjs.com/package/factag) package — same stage names, same JSONL fact-store format, same `=== VERIFIED FACTS ===` context block. Zero dependencies, standard library only.

```python
import asyncio
from factag import DirectoryLoader, HeuristicExtractor, RecursiveHeadingSplitter, MemoryFactStore, IngestionPipeline, BudgetAssembler

async def main():
    store = MemoryFactStore()
    result = await IngestionPipeline(
        loader=DirectoryLoader("./docs"),
        splitter=RecursiveHeadingSplitter(chunk_size=800, chunk_overlap=120),
        extractor=HeuristicExtractor(),
        store=store,
    ).run()
    print(result)  # IngestResult(documents=..., chunks=..., raw=..., kept=...)

    block = await BudgetAssembler(store, budget=4000).to_context("what does the business plan cost?")
    print(block)
    # === VERIFIED FACTS ===
    # - (file:///.../pricing.md) importance=5 category=pricing Business plan costs $99 per month...
    # === END VERIFIED FACTS ===

asyncio.run(main())
```

## FAG Watch (live website monitoring)

```python
import asyncio
from factag import MemoryFactStore, WatchSession, HeuristicExtractor

async def main():
    store = MemoryFactStore()
    session = WatchSession(
        "https://example.com/docs",
        store,
        interval_seconds=60,          # >= 5 — be kind to the websites you monitor
        extractor=HeuristicExtractor(),
        prune_stale=True,             # delete facts the site no longer reports
        headers={"user-agent": "Mozilla/5.0 ..."},  # for bot-protected sites
        on_event=lambda e: print(e.kind, getattr(getattr(e, "result", None), "added", "")),
    )
    session.start()
    await asyncio.sleep(3600)         # the session polls forever until session.stop()
    session.stop()

asyncio.run(main())
```

One pass = fetch → whitespace-stable hash (unchanged: nothing written) → on change:
re-ingest with `fact_key` cross-run dedupe (only genuinely new sentences are added)
→ facts the site no longer produces are counted and, with `prune_stale`, deleted.
`poll_source()` is the single-pass API. A TS indexer can write `facts.jsonl` that
this Python twin reads byte-identically (and vice versa).

Install: `pip install factag`

Full documentation, design principles and the FAG spec: see the [repository README](https://github.com/qfg5182-ui/fact-augmented-generation).
