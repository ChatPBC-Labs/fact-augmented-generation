# factag

**Fact-Augmented Generation (FAG)** — extract facts once, inject on every call. A RAG-shaped grounding library with zero runtime dependencies: loaders → recursive heading splitter → extractor (LLM or zero-key heuristic) → normalizer → fact store → budget assembler.

```ts
import { DirectoryLoader, RecursiveHeadingSplitter, HeuristicExtractor, MemoryFactStore, BudgetAssembler, runIngest } from "factag";

const store = new MemoryFactStore();
await runIngest({
  loader: new DirectoryLoader("./docs"),
  splitter: new RecursiveHeadingSplitter({ chunkSize: 800, chunkOverlap: 120 }),
  extractor: new HeuristicExtractor(), // or new LLMExtractor({ apiKey, baseUrl, model })
  store,
});

const context = await new BudgetAssembler(store, { budget: 4000 }).toContext("what does the business plan cost?");
// === VERIFIED FACTS ===
// - (https://example.com/pricing) importance=5 category=pricing Business plan costs $99 per month...
// === END VERIFIED FACTS ===
```

- `BudgetAssembler.assemble()` → `{ context, included, omitted, chars }`
- `BudgetAssembler.invoke()` → facts (retriever-style)
- `BudgetAssembler.toContext()` → the `=== VERIFIED FACTS ===` block
- LangChain: use [`factag-langchain`](https://www.npmjs.com/package/factag-langchain) for a drop-in `FagRetriever`
- Python: [`pip install factag`](https://pypi.org/project/factag/)

Full docs and design principles: see the [repository](https://github.com/factag-generator/fact-augmented-generation).
