# Fact-Augmented Generation (FAG)

**Extract facts once. Inject on every call.**

FAG is a retrieval-free grounding technique for LLMs, built for *bounded* knowledge — your product docs, your website, your policies, your FAQ. Instead of searching documents at query time (RAG), FAG distills your corpus into standalone, source-attributed facts at ingest time and injects them straight into the prompt.

```
RAG:  Load → Split → Embed → Store │ Query → Embed → Search → Rerank → Prompt → LLM
FAG:  Load → Split → Extract → Store│ (budget) Assemble → Prompt → LLM
```

## Why

RAG's production failure mode is retrieval: the right chunk exists, but the wrong one gets fetched. Every "advanced RAG" technique — hybrid search, rerankers, query rewriting, agentic re-retrieval — exists to hide that failure. FAG removes the step entirely:

- **No retrieval = no retrieval failures.** Facts are already distilled and ranked.
- **No infrastructure.** No vector database, no embedding model, no reranker service.
- **Citations built in.** Every fact carries the `sourceUrl` it came from.
- **Faster and cheaper per query.** One injection instead of a search pipeline.

When your knowledge doesn't fit a prompt budget, a keyword overflow retriever kicks in — the escape hatch, not the default.

## Install

```bash
npm install factag          # core (TypeScript, zero runtime dependencies)
npm install factag-cli      # command line
npm install factag-langchain  # drop-in FagRetriever for LangChain apps
pip install factag          # Python twin
```

## Quickstart

```ts
import { URLLoader, RecursiveHeadingSplitter, HeuristicExtractor, MemoryFactStore, BudgetAssembler } from "factag";

const docs    = await new URLLoader("https://example.com/pricing").load();
const splitter = new RecursiveHeadingSplitter({ chunkSize: 1000, chunkOverlap: 100 });
const splits  = await splitter.splitDocuments(docs);

const store = new MemoryFactStore();
await store.addDocuments(await new HeuristicExtractor().extractDocuments(splits));

const assembler = store.asAssembler({ budget: 8000 });
const context = await assembler.toContext();
// === VERIFIED FACTS ===
// - (https://example.com/pricing) importance=5 category=pricing Starter plan costs $29/month.

const answer = await myLlm.generate([
  { role: "system", content: `${context}\nAnswer using the verified facts above.` },
  { role: "user",  content: "What does the starter plan cost?" },
]);
```

Side-by-side with the equivalent RAG pipeline: [`examples/rag-vs-fag.ts`](examples/rag-vs-fag.ts).

## How it works

| # | Stage | What happens |
|---|-------|--------------|
| 1 | **Load** | `URLLoader`, `SitemapLoader`, `DirectoryLoader`, `TextLoader` → `Document[]` |
| 2 | **Split** | `RecursiveHeadingSplitter` chunks at heading/paragraph boundaries (same API as RAG splitters) |
| 3 | **Extract** | `LLMExtractor` (any OpenAI-compatible endpoint, your key) or `HeuristicExtractor` (zero-key: numbers, prices, dates, definitions, specs) → `Fact[]` |
| 4 | **Normalize** | dedupe by shingle overlap, strip boilerplate, rank by importance |
| 5 | **Store** | `MemoryFactStore` / `FileFactStore` (JSONL) / `SQLiteFactStore` — plain local storage |
| 6 | **Assemble** | `BudgetAssembler` packs facts by importance within a character budget; `KeywordRetriever` handles overflow |

## FAG Watch — continuous website monitoring

A store can follow a website and stay current on its own (added in 0.1.2–0.1.4,
TypeScript and Python):

```bash
factag watch https://example.com/docs --interval 60 --out live.jsonl --prune
#   WEBSITE CHANGED: +1 new fact(s), 12 unchanged, pruned 1 stale
#   no change (hash 26578961)
```

- One pass = fetch → whitespace-stable hash → unchanged = nothing written;
  changed = re-ingest with `factKey` cross-run dedupe (only genuinely new
  sentences are added), then facts the site no longer reports are counted as
  stale — `--prune` deletes them (`store.removeWhere`).
- `WatchSession` loops forever, non-overlapping ticks, interval floor 5 s
  ("be kind to the websites you monitor"). Emits `change` / `nochange` / `error`.
- Bot-protected sites (e.g. behind cloudflare) that reject non-browser agents:
  `--user-agent "<browser UA>"` on the CLI or `headers: { ... }` on
  `pollSource` / `WatchSession`.
- Errors are per-tick events, not crashes: a failed fetch logs and retries next interval.
- Grounded answers always reflect the site *as it is now*: pair the store with
  `factag ask --facts live.jsonl`.

## The class map (if you know RAG, you know FAG)

| RAG | FAG |
|-----|-----|
| `Document` | `Document` (same fields) |
| `RecursiveCharacterTextSplitter` | `RecursiveHeadingSplitter` |
| `Embeddings` | `Extractor` (`LLMExtractor`, `HeuristicExtractor`) |
| `VectorStore` | `FactStore` (`Memory`, `File`, `SQLite`) |
| `asRetriever({ k })` | `asAssembler({ budget })` |
| `retriever.invoke(q)` | `assembler.invoke(q?)` → facts, not chunks |
| `retriever \| prompt \| llm` | `assembler \| prompt \| llm` |

## Design principles

1. **RAG-shaped API.** Same abstractions, same composition style — swap the middle, keep your app.
2. **Zero runtime dependencies.** Core uses only the platform (`fetch`, `fs`, `node:sqlite`).
3. **Your key, your endpoint, or no key at all.** No account, no telemetry, no calls to any service we operate. The only network calls are the URLs *you* ingest and the LLM *you* configure.
4. **Bounded knowledge first.** FAG is the right architecture when your corpus can be reasoned about as facts — docs, sites, policies, catalogs. For million-document corpora with per-user access control, use RAG.

## Operational notes (verified by the integration harness)

- **Re-indexing is idempotent.** `runIngest` skips facts already in the store (`skippedFromStore` in the result counts them). Wipe with `store.clear()` to force a fresh build.
- **Assemble with focus:** `assembler.assemble(query, { k: 5 })` packs only the top-5 lexically matching facts; without a query it takes the top-5 by importance. `toContext`/`invoke` take the same optional `{ k }`.
- **Hand-curated facts:** `createFact({ text, importance, category, sourceUrl })` (clamps importance to 1–5) or store plain `{ ... }` objects; `MemoryFactStore` also accepts a seed array.
- **LLM extraction failures are loud.** A dead endpoint or bad key surfaces as an error, not as "0 facts extracted".
- **Cross-runtime parity.** The JSONL store format, wire schema and `BudgetAssembler` output are byte-identical between the TypeScript and Python packages, so a Node indexer can feed a Python bot. The zero-key `HeuristicExtractor` rules are tuned per runtime, so *importance/category* signals may differ slightly — treat them as heuristics, not contracts.

## Repository layout

```
packages/factag/           core library (npm)
packages/factag-cli/       CLI: factag index | watch | ask | stats
packages/factag-langchain/ LangChain FagRetriever drop-in
python/factag/             Python twin (PyPI)
spec/                      FAG Context Protocol specification
examples/                  01-index, 02-ask, rag-vs-fag, langchain-dropin
docs/DEVELOPER.md          developer guide (build, test, harness, release)
```

## License

Apache-2.0 — see [LICENSE](LICENSE).
