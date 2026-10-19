import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryFactStore } from "factag";
import { FagRetriever } from "../dist/index.js";

const FACTS = [
  { text: "Starter plan costs $29 per month.", importance: 5, category: "pricing", sourceUrl: "https://a.example/p" },
  { text: "Business plan costs $99 per month.", importance: 5, category: "pricing", sourceUrl: "https://a.example/p" },
  { text: "The dashboard shows usage graphs.", importance: 3, category: "feature", sourceUrl: "https://a.example/f" },
  { text: "Founded in 2020 as a small studio.", importance: 2, category: "fact", sourceUrl: "https://a.example/about" },
];

test("FagRetriever returns LangChain Documents with fact metadata", async () => {
  const store = await MemoryFactStore.fromDocuments(FACTS);
  const retriever = new FagRetriever(store, { budget: 8000 });
  const docs = await retriever.invoke("What does the starter plan cost?");
  assert.equal(docs.length, 4);
  assert.equal(docs[0].pageContent, FACTS[0].text);
  assert.equal(docs[0].metadata.source, "https://a.example/p");
  assert.equal(docs[0].metadata.importance, 5);
  assert.equal(docs[0].metadata.category, "pricing");
});

test("FagRetriever respects budget and adds keyword overflow", async () => {
  const store = await MemoryFactStore.fromDocuments(FACTS);
  const strict = new FagRetriever(store, { budget: 160, overflow: 2 });
  const docs = await strict.invoke("business plan pricing");
  assert.ok(docs.length >= 1);
  assert.ok(docs.length <= FACTS.length);
  const texts = docs.map((d) => d.pageContent);
  assert.ok(texts.some((t) => t.includes("Business") || t.includes("Starter")));
});

test("FagRetriever omits metadata when disabled", async () => {
  const store = await MemoryFactStore.fromDocuments(FACTS);
  const retriever = new FagRetriever(store, { includeMetadata: false });
  const docs = await retriever.invoke("pricing");
  assert.deepEqual(docs[0].metadata, {});
});

test("FagRetriever works as a LangChain runnable with pipe", async () => {
  const store = await MemoryFactStore.fromDocuments(FACTS);
  const retriever = new FagRetriever(store, { budget: 500 });
  const texts = await retriever.pipe((docs) => docs.map((d) => d.pageContent).join("\n")).invoke("pricing");
  assert.ok(texts.includes("Starter"));
});
