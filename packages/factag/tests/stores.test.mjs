import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BudgetAssembler, FACTS_HEADER, FileFactStore, MemoryFactStore, KeywordRetriever } from "../dist/index.js";

const FACTS = [
  { text: "Starter plan costs $29 per month.", importance: 5, category: "pricing", sourceUrl: "https://a.example/p" },
  { text: "Business plan costs $99 per month.", importance: 5, category: "pricing", sourceUrl: "https://a.example/p" },
  { text: "The dashboard shows usage graphs.", importance: 3, category: "feature", sourceUrl: "https://a.example/f" },
  { text: "Founded in 2020 as a small studio.", importance: 1, category: "fact", sourceUrl: "https://a.example/about" },
];

test("MemoryFactStore roundtrip", async () => {
  const store = new MemoryFactStore();
  await store.addDocuments(FACTS);
  assert.equal(await store.size(), 4);
  const all = await store.all();
  assert.equal(all[0].text, FACTS[0].text);
  await store.clear();
  assert.equal(await store.size(), 0);
});

test("FileFactStore persists JSONL across instances", async () => {
  const dir = await mkdtemp(join(tmpdir(), "factag-"));
  const path = join(dir, "facts.jsonl");
  try {
    const store = await FileFactStore.fromDocuments(FACTS, path);
    assert.equal(await store.size(), 4);
    const reopened = new FileFactStore(path);
    assert.equal(await reopened.size(), 4);
    await reopened.clear();
    assert.equal(await reopened.size(), 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("BudgetAssembler packs by importance within budget", async () => {
  const store = await MemoryFactStore.fromDocuments(FACTS);
  const assembler = store.asAssembler({ budget: 260 });
  const result = await assembler.assemble();
  assert.ok(result.context.startsWith(FACTS_HEADER));
  assert.ok(result.context.includes("=== END VERIFIED FACTS ==="));
  assert.ok(result.context.length <= 260);
  assert.ok(result.included[0].importance >= result.included[result.included.length - 1].importance);
  assert.ok(result.chars === result.context.length);
  assert.ok(result.included.length + result.omitted.length === FACTS.length);
});

test("BudgetAssembler returns empty context for empty store", async () => {
  const store = new MemoryFactStore();
  const context = await store.asAssembler().toContext();
  assert.equal(context, "");
});

test("KeywordRetriever ranks by token overlap", async () => {
  const store = await MemoryFactStore.fromDocuments(FACTS);
  const retriever = store.asKeywordRetriever({ k: 2 });
  const hits = await retriever.invoke("What does the starter plan cost?");
  assert.ok(hits.length >= 1);
  assert.ok(hits[0].text.includes("Starter"));
  assert.ok(hits.length <= 2);
});

test("BudgetAssembler then KeywordRetriever overflow pattern", async () => {
  const store = await MemoryFactStore.fromDocuments(FACTS);
  const result = await store.asAssembler({ budget: 150 }).assemble();
  assert.ok(result.omitted.length > 0, "small budget should omit some facts");
  const overflow = await new KeywordRetriever({ all: async () => result.omitted }, { k: 5 }).invoke("business plan");
  assert.ok(overflow.length >= 1);
  assert.ok(overflow[0].text.includes("Business"));
});
