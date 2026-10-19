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

Install: `pip install factag`

Full documentation, design principles and the FAG spec: see the [repository README](https://github.com/factag-generator/fact-augmented-generation).
