// 01 — Index a folder of documents into a fact store (zero keys, heuristic extractor).
// Run: node examples/01-index.ts
import { DirectoryLoader, RecursiveHeadingSplitter, HeuristicExtractor, FileFactStore, runIngest } from "factag";

const out = new URL("./facts.jsonl", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const result = await runIngest({
  loader: new DirectoryLoader(new URL("./data", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  splitter: new RecursiveHeadingSplitter({ chunkSize: 600, chunkOverlap: 80 }),
  extractor: new HeuristicExtractor(),
  store: new FileFactStore(out),
  normalize: true,
});

console.log(`documents=${result.documents} chunks=${result.chunks} facts=${result.facts} kept=${result.kept}`);
console.log(`fact store written → ${out}`);
console.log("next: node examples/02-ask.ts");
