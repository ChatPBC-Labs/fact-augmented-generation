# factag

**Fact-Augmented Generation (FAG)** — extract facts once, inject on every call.

A RAG-shaped grounding library with **zero runtime dependencies**:

```
load → split → extract → normalize → fact store → (budget) assemble → prompt
```

Instead of searching documents at query time, `factag` distills a corpus (and follows it over time) into standalone, source-attributed facts — then injects the facts straight into your prompt.

> **CommonJS:** `require('factag')` works on Node.js >= 22.12 (and 20.19+ with `--experimental-require-module`). Prefer ESM imports.

## What's in the box

| Stage | Exports | Notes |
|---|---|---|
| Load | `URLLoader`, `SitemapLoader`, `DirectoryLoader`, `TextLoader` | URLs / sitemap trees / local dirs / inline text+HTML; `headers` option for bot-protected sites |
| Split | `RecursiveHeadingSplitter` | heading/paragraph boundaries, configurable `chunkSize`/`chunkOverlap` |
| Extract | `HeuristicExtractor`, `LLMExtractor` | zero-key by default (numbers, prices, dates, specs, definitions); LLM = any OpenAI-compatible endpoint |
| Normalize | `normalizeFacts`, `factKey` | importance 1–5 clamp, category tags, cross-run dedupe |
| Store | `MemoryFactStore`, `FileFactStore`, `SqliteFactStore` | JSONL contract: first line `{"_type":"fag-store","version":1}`; `removeWhere` on all stores |
| Assemble | `BudgetAssembler`, `KeywordRetriever` | `=== VERIFIED FACTS ===` context blocks within a character budget; keyword overflow |
| **Watch** | `pollSource`, `WatchSession`, `stableHash`, `normalizeSource` | continuous website monitoring: change → re-extract → dedupe → optional prune |

Each fact is a plain object: `text`, `importance` (1–5), `category` (fact/pricing/limit/feature/contact...), `sourceUrl`, `chunkId`, `metadata` (heading etc.).

## Quickstart

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

## FAG Watch

Keep a store current from a URL — nothing to schedule, nothing to run yourself:

```ts
import { WatchSession } from "factag";

const session = new WatchSession({
  source: "https://example.com/docs",
  store,
  intervalMs: 60_000,          // >= 5000 required — be kind to the site
  pruneStale: true,            // delete facts the site no longer reports
  headers: { "user-agent": "Mozilla/5.0 ..." }, // for bot-protected sites
  onEvent: (event) => {
    if (event.kind === "change") console.log("changed:", event.added, "new,", event.pruned, "pruned");
  },
});
session.start();               // polls forever; stop() to end
```

- one pass: fetch → whitespace-stable hash → unchanged = nothing written
- changed: re-ingest with `factKey` cross-run dedupe — only genuinely new sentences get added
- stale facts (site no longer reports them): removed only with `pruneStale: true`
- errors are per-tick events, never crashes; `pollSource()` is the single-pass API
- CLI equivalent: `factag watch <url> --interval 60 --out live.jsonl --prune [--user-agent <ua>]`

## API surface

- `BudgetAssembler.assemble()` → `{ context, included, omitted, chars }`
- `BudgetAssembler.invoke()` → facts (retriever-style)
- `BudgetAssembler.toContext()` → the `=== VERIFIED FACTS ===` block
- `runIngest()` → `{ chunks, facts, kept, skippedFromStore }` (idempotent re-ingest: `kept` counts only store-new facts)
- `store.addDocuments`, `store.all()`, `store.clear()`, `store.removeWhere(pred)`, `store.asAssembler`, `store.asKeywordRetriever`
- LangChain: use [`factag-langchain`](https://www.npmjs.com/package/factag-langchain) for a drop-in `FagRetriever`
- Python: [`pip install factag`](https://pypi.org/project/factag/) — byte-identical JSONL contract + the same watcher twin

Full docs and design principles: see the [repository](https://github.com/qfg5182-ui/fact-augmented-generation).
