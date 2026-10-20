# factag-cli

Command-line interface for Fact-Augmented Generation (FAG).

```bash
npm install -g factag-cli
```

## Commands

| Command | What it does |
|---|---|
| `factag index <url\|sitemap.xml\|dir> --out facts.jsonl` | load → split → extract → normalize → store (idempotent: re-running never duplicates facts) |
| `factag watch <url\|sitemap.xml\|path> --interval <sec> --out live.jsonl` | continuous website monitoring — prints `WEBSITE CHANGED` and keeps the store current forever |
| `factag ask "question" --facts facts.jsonl` | grounded answer from the fact store; refuses to answer outside the facts |
| `factag stats --facts facts.jsonl` | store overview (facts, categories, sources) |
| `factag export --facts facts.jsonl --format jsonl` | print facts in a chosen format |
| `factag --version` | `factag-cli <cli version> (core factag <core version>)` |

## index / watch options

```
--out <file>            output store (JSONL, "fag-store" header + one fact per line)
--chunk-size <n>        chars per chunk (default 1000)
--chunk-overlap <n>     overlap between chunks (default 100)
--max-per-source <n>    cap extracted facts per source
--llm                   use LLM extraction instead of the zero-key heuristic
--model <name>          model name for LLM extraction
--base-url <url>        any OpenAI-compatible endpoint
--key-env <ENV_VAR>     name of the env var holding your API key (key never on argv)
```

## watch-only options

```
--interval <sec>        seconds between polls (>= 5 — be kind to the websites you monitor; default 300)
--prune                 delete facts the site no longer reports (`removeWhere` on the store)
--quiet                 suppress "no change" lines
--user-agent <ua>       custom user-agent — e.g. a browser UA for sites behind bot protection
```

## The watch loop, verbatim

```
$ factag watch https://yonile.vercel.app --interval 30 --out yonile-live.jsonl --prune
watching https://yonile.vercel.app every 30s -> .../yonile-live.jsonl
  14:47:52 WEBSITE CHANGED: +3 new fact(s), 0 unchanged
  14:48:12 no change (hash 34168e6d)
  14:48:42 no change (hash 34168e6d)
```

While it runs, `yonile-live.jsonl` is always the site *as it is now* — pair it with
`factag ask "..." --facts yonile-live.jsonl` and your answers never go stale.
Errors (a site down, a 403) are logged per tick and retried at the next interval —
the loop never crashes.

Docs: https://github.com/qfg5182-ui/fact-augmented-generation
