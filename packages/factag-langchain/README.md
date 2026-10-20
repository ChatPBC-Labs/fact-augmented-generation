# factag-langchain

Drop-in FagRetriever for [LangChain](https://js.langchain.com) — serve verified FAG facts wherever a retriever is expected.

```ts
import { FagRetriever } from "factag-langchain";

const retriever = new FagRetriever(store, { budget: 8000, overflow: 2 });
const docs = await retriever.invoke("what does the business plan cost?");
// LangChain Documents with metadata: { source, importance, category }
chain = retriever.pipe(chatModel).pipe(new StringOutputParser());
```

**Keep the facts current** — pair it with FAG Watch: the store can be continuously
rebuilt from a website (`factag watch <url> --out facts.jsonl`), and every retrieval
serves the site's *latest* verified facts. Useful flags on the watch side:
`--prune` deletes facts the site no longer reports, `--user-agent <ua>` lets you
monitor bot-protected sites (a browser UA). Same in the core API:
`WatchSession` / `pollSource` from `factag/watcher` accept
`pruneStale` / `headers`.

Docs: https://github.com/factag-generator/fact-augmented-generation
