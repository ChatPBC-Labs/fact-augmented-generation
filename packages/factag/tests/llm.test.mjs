import assert from "node:assert/strict";
import { test } from "node:test";
import { Document, LLMExtractor, parseFactJson } from "../dist/index.js";

test("parseFactJson handles plain object", () => {
  const out = parseFactJson('{"facts":[{"text":"Starter costs $29.","importance":5,"category":"pricing","chunkIndex":1}]}');
  assert.equal(out.length, 1);
  assert.equal(out[0].text, "Starter costs $29.");
  assert.equal(out[0].importance, 5);
  assert.equal(out[0].category, "pricing");
  assert.equal(out[0].chunkIndex, 1);
});

test("parseFactJson handles fenced array and coerces importance", () => {
  const out = parseFactJson('```json\n[{"text":"A fact here.","importance":"9"}]\n```');
  assert.equal(out.length, 1);
  assert.equal(out[0].importance, 5);
});

test("parseFactJson rejects garbage", () => {
  assert.throws(() => parseFactJson("no json here"));
});

test("LLMExtractor maps responses to facts with stubbed fetch", async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                facts: [
                  { text: "The starter plan costs $29 per month.", importance: 5, category: "pricing", chunkIndex: 0 },
                  { text: "Too minor filler.", importance: 1, category: "fact", chunkIndex: 0 },
                ],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  const extractor = new LLMExtractor({ apiKey: "test-key", baseUrl: "https://llm.example/v1", model: "test-model", fetchFn, importanceFloor: 2 });
  const docs = [
    new Document({ pageContent: "chunk one", metadata: { url: "https://example.com/a", chunkId: "a#0" } }),
    new Document({ pageContent: "chunk two", metadata: { url: "https://example.com/b", chunkId: "b#0" } }),
  ];
  const facts = await extractor.extractDocuments(docs);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://llm.example/v1/chat/completions");
  assert.equal(calls[0].body.model, "test-model");
  assert.equal(facts.length, 1, "importance floor should drop fact #2");
  assert.equal(facts[0].sourceUrl, "https://example.com/a");
  assert.equal(facts[0].chunkId, "a#0");
  assert.equal(facts[0].importance, 5);
});

test("LLMExtractor retries on 429 then succeeds", async () => {
  let attempts = 0;
  const fetchFn = async () => {
    attempts++;
    if (attempts === 1) return new Response("rate limited", { status: 429 });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: '{"facts":[{"text":"Recovered fact here.","importance":3}]}' } }] }),
      { status: 200 }
    );
  };
  const extractor = new LLMExtractor({ apiKey: "k", fetchFn, maxRetries: 2 });
  const facts = await extractor.extractDocuments([new Document({ pageContent: "x", metadata: { url: "u" } })]);
  assert.equal(attempts, 2);
  assert.equal(facts.length, 1);
});

test("LLMExtractor batches by batchSize", async () => {
  let calls = 0;
  const fetchFn = async () => {
    calls++;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"facts":[]}' } }] }), { status: 200 });
  };
  const extractor = new LLMExtractor({ apiKey: "k", fetchFn, batchSize: 2, concurrency: 1 });
  const docs = Array.from({ length: 5 }, (_, i) => new Document({ pageContent: `c${i}`, metadata: { url: `u${i}` } }));
  await extractor.extractDocuments(docs);
  assert.equal(calls, 3);
});
