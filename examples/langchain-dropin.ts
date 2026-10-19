// langchain-dropin — FagRetriever behaves exactly like a LangChain retriever.
// Run: node examples/langchain-dropin.ts
import { DirectoryLoader, RecursiveHeadingSplitter, HeuristicExtractor, MemoryFactStore, runIngest } from "factag";
import { FagRetriever } from "factag-langchain";

const dir = new URL("./data", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const store = new MemoryFactStore();
await runIngest({
  loader: new DirectoryLoader(dir),
  splitter: new RecursiveHeadingSplitter({ chunkSize: 600, chunkOverlap: 80 }),
  extractor: new HeuristicExtractor(),
  store,
});

const retriever = new FagRetriever(store, { budget: 3000, overflow: 2 });
const query = "does business include chat support?";

const docs = await retriever.invoke(query);
console.log(`retriever.invoke() → ${docs.length} Documents\n`);
for (const doc of docs.slice(0, 5)) {
  console.log(`- [imp ${doc.metadata.importance} · ${doc.metadata.category}] ${doc.pageContent}`);
}

// composes with LangChain runnables via .pipe()
const joined = await retriever.pipe((ds: { pageContent: string }[]) => ds.map((d) => d.pageContent).join("\n")).invoke(query);
console.log(`\n.pipe() output → ${joined.length} chars`);
