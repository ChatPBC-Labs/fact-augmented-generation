import assert from "node:assert/strict";
import { test } from "node:test";
import { Document, HeuristicExtractor } from "../dist/index.js";

const DOC = new Document({
  pageContent: [
    "# Pricing",
    "The Starter plan costs $29 per month and includes 10 API keys.",
    "Support is reachable at help@example.com.",
    "Our office closes on December 25, 2026 for the holidays.",
    "Random navigation text menu home blog contact click here.",
    "The API rate limit is 100 requests per minute on Business.",
  ].join("\n"),
  metadata: { url: "https://example.com/pricing" },
});

test("extracts priced facts with source attribution", async () => {
  const facts = await new HeuristicExtractor().extractDocuments([DOC]);
  assert.ok(facts.length >= 2, `expected >= 2 facts, got ${facts.length}`);
  const price = facts.find((f) => f.text.includes("$29"));
  assert.ok(price, "price fact missing");
  assert.equal(price.sourceUrl, "https://example.com/pricing");
  assert.equal(price.category, "pricing");
  assert.ok(price.importance >= 3);
});

test("extracts emails and limits", async () => {
  const facts = await new HeuristicExtractor().extractDocuments([DOC]);
  assert.ok(facts.some((f) => f.text.includes("help@example.com")));
  assert.ok(facts.some((f) => f.text.includes("100 requests per minute")));
});

test("boilerplate navigation is skipped", async () => {
  const facts = await new HeuristicExtractor().extractDocuments([DOC]);
  assert.ok(!facts.some((f) => f.text.includes("click here")));
});

test("deduplicates identical sentences across docs", async () => {
  const doc2 = new Document({ pageContent: DOC.pageContent, metadata: { url: "https://example.com/pricing" } });
  const facts = await new HeuristicExtractor().extractDocuments([DOC, doc2]);
  const texts = facts.map((f) => f.text);
  assert.equal(new Set(texts).size, texts.length);
});
