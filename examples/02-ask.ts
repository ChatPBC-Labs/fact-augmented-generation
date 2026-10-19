// 02 — Assemble a verified-facts context block for any LLM.
// Run: node examples/02-ask.ts "what does the business plan cost?"
// Set OPENAI_API_KEY (+ optional OPENAI_BASE_URL, OPENAI_MODEL) to have the
// answer completed by an LLM; without it you just get the context block.
import { FileFactStore, BudgetAssembler } from "factag";

const query = process.argv[2] ?? "what does the business plan cost?";
const out = new URL("./facts.jsonl", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const store = new FileFactStore(out);
const facts = await store.all();
if (facts.length === 0) {
  console.error("No facts yet — run `node examples/01-index.ts` first.");
  process.exit(1);
}

const context = await new BudgetAssembler(store, { budget: 4000 }).toContext(query);
console.log(context);

const apiKey = process.env.OPENAI_API_KEY;
if (apiKey) {
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "Answer using ONLY the verified facts. If the facts do not cover it, say so." },
        { role: "user", content: `${context}\n\nQuestion: ${query}` },
      ],
    }),
  });
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  console.log("\n--- answer ---");
  console.log(data.choices?.[0]?.message?.content ?? "(no answer)");
} else {
  console.log("\n(set OPENAI_API_KEY to have the answer generated from these facts)");
}
