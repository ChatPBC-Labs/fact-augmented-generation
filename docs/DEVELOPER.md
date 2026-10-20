# Developer Guide

Everything needed to develop, test, and release FAG locally.

## What FAG is, in one paragraph (why this code looks the way it does)

FAG is a grounded-LLM knowledge pipeline shaped like RAG but without retrieval.
Anything a user can point a URL or a folder at gets turned into **single-sentence
facts** with `importance`, `category` and `sourceUrl`; the LLM context is the
fact list itself, capped by a character budget. There is no vector DB, no
embeddings model and no ranker service to deploy — the store is memory, JSONL
or SQLite, and re-ingesting anything never duplicates a fact. Because facts are
source-attributed, a store can *follow a website*: FAG Watch re-checks a target
on an interval, adds what is new, and (optionally) deletes what the site no
longer says. Anything you change must preserve those invariants:

1. `factKey` cross-run dedupe — same source + same normalized text never republishes.
2. `PollResult.added === IngestResult.kept` (already store-new; do not re-subtract).
3. Byte-identical JSONL wire contract between TS and Python.
4. Watch interval floor 5000 ms, everywhere (core + CLI + Python twin).

## Monorepo layout

```
packages/factag/           core TypeScript library (zero runtime deps)
packages/factag-cli/       `factag` CLI (depends on factag)
packages/factag-langchain/ LangChain FagRetriever drop-in
python/factag/             Python twin (pure stdlib)
examples/                  runnable examples (node examples/01-index.ts)
spec/                      FAG Context Protocol spec
.github/scripts/           firewall-check (banned-string scanner)
```

## Local setup

```bash
npm install            # installs all workspaces
python -m pip install build hatchling   # only needed to build the PyPI package
```

## Everyday commands

- Watch (live): `factag watch <url|sitemap.xml|dir> --interval 60 --out live.jsonl [--prune] [--user-agent <ua>]`

| Command | What it does |
|---|---|
| `npm run build` | tsc for all 3 npm packages |
| `npm test` | node:test suites in all packages (factag 51, cli 3, langchain 4) |
| `npm run test:python` | python unittest suite (28 tests incl. watcher twins) |
| `npm run firewall` | scans every file for banned strings (must be 0 hits) |
| `npm run verify` | build + test + firewall — run before every commit |

Python tests run in-place:

```bash
cd python/factag
python -m unittest discover -s tests -v
```

## Building packages locally

```bash
# npm tarballs (check what ships before publishing)
npm pack --dry-run --pack-destination ../out   # from each package dir
# python sdist + wheel
cd python/factag && python -m build
```

## Testing as a real consumer (the bot harness)

The integration harness consumes the *packed tarballs* exactly like a published
package — nothing symlinked to the repo:

```
temp dir/
  package.json   { "factag": "file:./vendor/factag-0.1.0.tgz", ... }
  vendor/        factag, factag-cli, factag-langchain tarballs
  docs/          corpus: md + html + unicode + no-extractable-facts
  mock.mjs       local OpenAI-compatible mock + web pages (429 retry tests)
  bot.mjs        ingest → assemble → LangChain → LLM → loaders assertions
  pybot.py       wheel install, reads the JSONL the TS bot wrote, compares
                 context blocks byte-for-byte with TS output
```

Wheel + tarball gotchas learned the hard way:

- after re-packing a tarball, delete `package-lock.json` before reinstalling —
  npm pins stale tarballs by integrity hash otherwise
- run `node --test "tests/*.test.mjs"` (glob), never `node --test tests/` — the
  bare directory arg fails on Windows
- never roundtrip UTF-8 through `Set-Content` in PowerShell 5.1 (mojibake)

## Semantics you must preserve when changing core

- `BudgetAssembler.assemble(query, { k })`: `k` with a query = lexically
  focused; `k` without a query = top-k by importance; without `k` = pack
  importance-ordered until budget.
- `invoke()` → `Fact[]`, `toContext()` → the `=== VERIFIED FACTS ===` string
  (Python: `invoke` / `to_context`, identical semantics).
- `runIngest` dedupes across runs via `factKey` (sourceUrl + normalized text);
  the result carries `skippedFromStore`. Clearing the store resets.
- **Watch (`pollSource` / `WatchSession`, `factag watch`):** hash change =
  re-ingest with cross-run dedupe, `added === kept` (already counts only
  store-new facts — do not subtract `skippedFromStore` again). Stale facts are
  `removedCandidates` (facts still in the store from this source that the
  fresh content no longer produces); they are deleted only with
  `pruneStale`/`--prune` via `store.removeWhere`. `PollResult.ingest` carries
  the raw `IngestResult`. Interval floor 5000 ms, enforced in the session API
  and the CLI. `headers`/`--user-agent` are threaded into both fetches of a
  poll (main + dry re-extract). Errors are per-tick events, never crashes.
  TS and Python twins share identical poll/watch semantics; Python `removed`
  is a separate list (mirror of `removedCandidates`).
- Wire format is a contract: JSONL, first line `{"_type":"fag-store","version":1}`,
  fields `text/importance/category/sourceUrl/chunkId/metadata`. TS writes what
  Python reads, byte-identically.
- Importance is always clamped to 1..5 at every entry point (`createFact`,
  `coerceImportance`, Python `to_wire`/`from_wire`).

## Firewall

`.github/scripts/firewall-check.mjs` fails CI if any file contains strings from
the maintainers' commercial stack. Add new banned strings at the top of that
file only. The scanner excludes itself, node_modules, `.git`, and lockfiles.

## Release flow

1. `npm run verify` + python suite + bot harness — all green
2. bump versions in all 4 manifests (`packages/*` and `python/factag/pyproject.toml`) + `VERSION`s
3. commit, tag `vX.Y.Z`, push → `.github/workflows/release.yml` publishes
   npm ×3 (provenance) + PyPI via trusted publishing
4. first-time setup before trusting CI (see repo root README / handoff notes):
   - npmjs.com: package settings → Trusted Publisher → owner/repo/`release.yml`
   - pypi.org: factag → Publishing → same trio
