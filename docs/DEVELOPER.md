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

  ## Build your own website-watcher automation

FAG Watch ("monitor a website, keep my fact store current, alert me when it
changes") is just a **loop over one function**. There are two levels to hook into:

- **Full automation for you:** `WatchSession` (TS) / `WatchSession` (Python)
  already handles the interval, prevents overlapping passes, reports per-tick
  errors as events (never crashes), and enforces the 5000 ms floor. You only
  react to events.
- **Building it yourself:** call `pollSource` / `poll_source` once per cycle.
  Useful for cron-style one-shot jobs, serverless handlers, or when you want
  your own scheduling around the pass.

### TS recipe — WatchSession + persistence + notification

```ts
// watcher.mjs — node watcher.mjs  (ESM, zero extra deps)
import { readFileSync, writeFileSync } from "node:fs";
import {
  FileFactStore, HeuristicExtractor, WatchSession,
} from "factag";

const STATE = "./.watcher-state.json";      // survives restarts
const state = (() => { try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return {}; } })();

const session = new WatchSession({
  source: process.argv[2] ?? "https://example.com/docs",
  intervalMs: 60_000,                       // floor is 5000 — be kind
  pruneStale: true,                         // delete facts the site dropped
  headers: { "user-agent": "Mozilla/5.0 example-watcher/1.0" },
  store: new FileFactStore("./live.jsonl"), // the fact store itself persists
  onEvent: (e) => {
    if (e.kind === "change") {
      if (state.hash && e.added === 0 && e.pruned === 0) return; // reflow only
      console.log("changed:", { added: e.added, pruned: e.pruned });
      notify(`website changed: +${e.added} new, -${e.pruned} stale`); // your hook (Slack/webhook/email)
      writeFileSync(STATE, JSON.stringify({ hash: e.hash }));
    } else if (e.kind === "nochange") {
      console.log("no change (hash", e.hash + ")");
    } else {
      console.error("tick failed (retried next interval):", e.error);
    }
  },
});
function notify(text) { /* POST to your webhook here */ }
session.start();
```

Run it forever under `pm2`/`systemd`/`nodemon`, in a container, or as a Node
child process — errors never take it down, the next tick retries.

### Python twin — same shape

```python
# watcher.py — python watcher.py https://example.com/docs
import asyncio
from factag import FileFactStore, HeuristicExtractor, WatchSession

async def main():
    def on_event(e):
        if e.kind == "change":
            print("changed:", e.result.added, "new,", e.result.pruned, "pruned")
        elif e.kind == "nochange":
            print("no change (hash", e.hash + ")")
        else:
            print("tick failed (retried):", e.error)

    session = WatchSession(
        source="https://example.com/docs",
        interval=60,                          # seconds; floor is 5
        prune_stale=True,
        store=FileFactStore("./live.jsonl"),
        on_event=on_event,
    )
    await asyncio.sleep(3600)                 # or keep it running however you like
    session.stop()

asyncio.run(main())
```

### Cron / one-shot variant (no long-running process)

If you would rather not hold a process open, run **one poll per cron
invocation** and persist `lastHash` yourself — it is what turns
"re-index everything" into "detect a change":

```ts
const store = new FileFactStore("./live.jsonl");
const { hash, added, removedCandidates } = await pollSource({
  source: "https://example.com/docs",
  store,
  extractor: new HeuristicExtractor(),
  lastHash: readJson(STATE).hash,   // REQUIRED for change detection; without it every run re-ingests
  pruneStale: true,
});
writeJson(STATE, { hash });
```

Notes that matter:

- **Resume semantics:** the fact store is already persistent; only the `hash`
  is session-local. Persisting it yourself avoids one harmless re-ingest after
  restart (cross-run dedupe keeps the store correct either way).
- **Stale facts** are only *reported* by default (`removedCandidates` /
  `removed_candidates`); they are deleted from the store only when
  `pruneStale: true` / `prune_stale=True`. Requires a store that implements
  `removeWhere` (all bundled stores do).
- **Bot-protected sites:** pass browser-like headers (`headers` /
  `--user-agent` on the CLI). They are threaded into both fetches of a pass.
- **Never schedule faster than 5 seconds** — the session API throws below the
  floor on purpose; honor it in your own loops too.

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
