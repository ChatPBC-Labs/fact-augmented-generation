import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import * as fag from "../dist/index.js";
import { Document, LLMExtractor, MemoryFactStore, FileFactStore, BudgetAssembler } from "../dist/index.js";
import { htmlToText } from "../dist/loaders/html.js";

const DOCS = path.join(tmpdir(), "fag-regressions");

test("createFact is a runtime export and clamps importance", () => {
  assert.equal(typeof fag.createFact, "function");
  const fact = fag.createFact({ text: "  hello  ", importance: 99, category: "PRICING", sourceUrl: "" });
  assert.equal(fact.text, "hello");
  assert.equal(fact.importance, 5);
  assert.equal(fact.category, "pricing");
  assert.equal(fact.sourceUrl, "unknown");
  assert.throws(() => fag.createFact({ text: "", importance: 1, category: "x", sourceUrl: "s" }));
});

test("MemoryFactStore can be seeded through the constructor", async () => {
  const store = new MemoryFactStore([
    { text: "seeded fact one", importance: 3, category: "fact", sourceUrl: "s" },
  ]);
  assert.equal(await store.size(), 1);
});

test("re-ingesting identical corpus does not grow the store", async () => {
  rmSync(DOCS, { recursive: true, force: true });
  const dir = mkdtempSync(DOCS);
  const docDir = path.join(dir, "docs");
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(docDir, { recursive: true });
  writeFileSync(path.join(docDir, "a.md"), "# P\nStarter plan costs $29 per month.\n", "utf8");
  writeFileSync(path.join(docDir, "b.md"), "## S\nEmail support replies within one business day at help@acme.io.\n", "utf8");

  const storePath = path.join(dir, "facts.jsonl");
  const ingest = () =>
    fag.runIngest({
      loader: new fag.DirectoryLoader(docDir),
      splitter: new fag.RecursiveHeadingSplitter({ chunkSize: 600, chunkOverlap: 80 }),
      extractor: new fag.HeuristicExtractor(),
      store: new FileFactStore(storePath),
    });
  const r1 = await ingest();
  const r2 = await ingest();
  const r3 = await ingest();
  assert.equal(r1.skippedFromStore, 0);
  assert.equal(r2.kept, 0, "second run adds nothing");
  assert.equal(r2.skippedFromStore, r1.kept);
  assert.equal(r3.kept, 0);
  assert.equal((await new FileFactStore(storePath).size()), r1.kept);
});

test("assembler k focuses lexically with a query, importance-slices without", async () => {
  const store = await MemoryFactStore.fromDocuments([
    { text: "The Standard plan costs $49 per month.", importance: 5, category: "pricing", sourceUrl: "s1" },
    { text: "Retention: logs are kept for 30 days.", importance: 5, category: "policy", sourceUrl: "s2" },
    { text: "SSO via SAML is available on Scale.", importance: 4, category: "feature", sourceUrl: "s3" },
  ]);
  const withQ = await new BudgetAssembler(store, { budget: 800 }).assemble("sso saml", { k: 1 });
  assert.ok(withQ.included[0].text.includes("SAML"));
  const withoutQ = await new BudgetAssembler(store, { budget: 800 }).assemble("", { k: 2 });
  assert.deepEqual(withoutQ.included.map((f) => f.importance), [5, 5]);
});

test("html head/title text no longer leaks into extracted content", () => {
  const text = htmlToText("<html><head><title>OnlyHeadText</title><style>.x{}</style></head><body><p>visible fact $12</p></body></html>");
  assert.ok(!text.includes("OnlyHeadText"), text);
  assert.ok(text.includes("visible fact"));
});

test("LLM facts without chunkIndex are attributed to the lexically closest chunk", async () => {
  const docs = [
    new Document({ pageContent: "refunds take five business days to process.", metadata: { url: "src://refunds" } }),
    new Document({ pageContent: "moon landing occurred in 1969 with astronauts.", metadata: { url: "src://moon" } }),
  ];
  const fetchFn = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: JSON.stringify([{ text: "moon landing occurred in 1969 with astronauts.", importance: 4, category: "fact" }]) } }],
    }),
  });
  const extractor = new LLMExtractor({ apiKey: "k", baseUrl: "http://mock/v1", fetchFn });
  const facts = await extractor.extractDocuments(docs);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].sourceUrl, "src://moon");
});
