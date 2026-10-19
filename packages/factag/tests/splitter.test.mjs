import assert from "node:assert/strict";
import { test } from "node:test";
import { Document, RecursiveHeadingSplitter } from "../dist/index.js";

test("splitText respects chunkSize", () => {
  const splitter = new RecursiveHeadingSplitter({ chunkSize: 200, chunkOverlap: 20 });
  const text = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} about facts and grounding.`).join(" ");
  const chunks = splitter.splitText(text);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= 200 + 20 + 5, `chunk too long: ${chunk.length}`);
});

test("splitDocuments tracks heading paths", () => {
  const splitter = new RecursiveHeadingSplitter({ chunkSize: 80, chunkOverlap: 0 });
  const doc = new Document({
    pageContent: "# Pricing\nStarter costs $29 per month.\n## Enterprise\nEnterprise costs $99 per month.",
    metadata: { url: "https://example.com/pricing" },
  });
  const chunks = splitter.splitDocuments([doc]);
  assert.ok(chunks.length >= 2);
  const headings = chunks.map((c) => c.metadata.heading);
  assert.ok(headings.some((h) => h === "Pricing" || h === "Pricing > Enterprise"));
  for (const chunk of chunks) {
    assert.equal(chunk.metadata.url, "https://example.com/pricing");
    assert.ok(typeof chunk.metadata.chunkId === "string");
  }
});

test("overlap never duplicates content silently dropping", () => {
  const splitter = new RecursiveHeadingSplitter({ chunkSize: 60, chunkOverlap: 15 });
  const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
  const chunks = splitter.splitText(words);
  assert.ok(chunks.length >= 3);
  const all = chunks.join(" ");
  assert.ok(all.includes("word0"));
  assert.ok(all.includes("word39"));
});

test("rejects invalid options", () => {
  assert.throws(() => new RecursiveHeadingSplitter({ chunkSize: 10, chunkOverlap: 10 }));
  assert.throws(() => new RecursiveHeadingSplitter({ chunkSize: 0 }));
});

test("empty input returns no chunks", () => {
  const splitter = new RecursiveHeadingSplitter();
  assert.deepEqual(splitter.splitText("   "), []);
});
