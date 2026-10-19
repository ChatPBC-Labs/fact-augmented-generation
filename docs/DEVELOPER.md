# Developer Guide

Everything needed to develop, test, and release FAG locally.

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

| Command | What it does |
|---|---|
| `npm run build` | tsc for all 3 npm packages |
| `npm test` | node:test suites in all packages (factag 41, cli 3, langchain 4) |
| `npm run test:python` | python unittest suite (20 tests) |
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
