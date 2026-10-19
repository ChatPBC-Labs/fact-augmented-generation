// rag-vs-fag — the same corpus through naive fixed-chunk RAG vs the FAG pipeline.
// Run: node examples/rag-vs-fag.ts
import { DirectoryLoader, RecursiveHeadingSplitter, HeuristicExtractor, MemoryFactStore, BudgetAssembler, runIngest } from "factag";

const dir = new URL("./data", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const query = "what does the business plan cost?";

// --- naive RAG: fixed-size chunks, lexical top-k ------------------------------
const docs = await new DirectoryLoader(dir).load();
const naiveChunks: string[] = [];
for (const doc of docs) {
  for (let i = 0; i < doc.pageContent.length; i += 300) naiveChunks.push(doc.pageContent.slice(i, i + 300));
}
const tokens = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
const qTokens = [...tokens(query)];
const naiveTopK = naiveChunks
  .map((text) => ({ text, score: [...tokens(text)].filter((t) => qTokens.includes(t)).length }))
  .sort((a, b) => b.score - a.score)
  .slice(0, 4);

const naiveContext = naiveTopK.map((c) => c.text).join("\n...\n");

// --- FAG: extract → normalize → budget assembly -------------------------------
const store = new MemoryFactStore();
await runIngest({
  loader: new DirectoryLoader(dir),
  splitter: new RecursiveHeadingSplitter({ chunkSize: 600, chunkOverlap: 80 }),
  extractor: new HeuristicExtractor(),
  store,
});
const fagContext = await new BudgetAssembler(store, { budget: 1400 }).toContext(query);

const estTokens = (s: string) => Math.ceil(s.length / 4);
console.log(`query: "${query}"\n`);
console.log("=== NAIVE RAG (fixed 300-char chunks, top-k=4) ===");
console.log(`chunks retrieved: ${naiveTopK.length} · est. tokens: ${estTokens(naiveContext)}`);
console.log(naiveContext.slice(0, 600) + (naiveContext.length > 600 ? "\n..." : ""));
console.log("\n=== FAG (extracted verified facts, budget-packed) ===");
console.log(`facts included: ${fagContext.split("\n").filter((l) => l.startsWith("- (")).length} · est. tokens: ${estTokens(fagContext)}`);
console.log(fagContext);
