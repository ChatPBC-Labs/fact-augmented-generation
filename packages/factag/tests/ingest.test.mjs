import assert from "node:assert/strict";
import { test } from "node:test";
import { createIngestPipeline, MemoryFactStore, HeuristicExtractor, TextLoader, RecursiveHeadingSplitter, pipe } from "../dist/index.js";

test("runIngest pipeline: load → split → extract → normalize → store", async () => {
  const store = new MemoryFactStore();
  const stages = [];
  const pipeline = createIngestPipeline({
    loader: new TextLoader("# Pricing\nThe Pro plan costs $49 per month with 50 API keys.\nSupport: help@acme.io", {
      metadata: { url: "https://acme.example/pricing" },
    }),
    splitter: new RecursiveHeadingSplitter({ chunkSize: 200, chunkOverlap: 0 }),
    extractor: new HeuristicExtractor(),
    store,
    onProgress: (p) => stages.push(p.stage),
  });
  const result = await pipeline.run();
  assert.deepEqual(stages, ["load", "split", "extract", "normalize", "store"]);
  assert.equal(result.documents, 1);
  assert.ok(result.kept >= 1);
  assert.equal(await store.size(), result.kept);
  const all = await store.all();
  assert.ok(all.every((f) => f.sourceUrl === "https://acme.example/pricing"));
});

test("pipe composes stages in order", async () => {
  const order = [];
  const fn = pipe(
    async (v) => {
      order.push("a");
      return v + 1;
    },
    async (v) => {
      order.push("b");
      return v * 2;
    }
  );
  const out = await fn(3);
  assert.equal(out, 8);
  assert.deepEqual(order, ["a", "b"]);
});

test("ingest with normalize disabled keeps raw count", async () => {
  const store = new MemoryFactStore();
  const text = "The starter plan costs $29 per month. The starter plan costs $29 per month.";
  const result = await createIngestPipeline({
    loader: new TextLoader(text, { metadata: { url: "https://dup.example" } }),
    extractor: new HeuristicExtractor(),
    store,
    normalize: false,
  }).run();
  assert.equal(result.facts, result.kept);
});
