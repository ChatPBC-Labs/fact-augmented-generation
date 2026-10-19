import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeFacts, jaccard } from "../dist/index.js";

const base = { importance: 3, category: "fact", sourceUrl: "https://x.example" };

test("jaccard similarity", () => {
  const a = new Set(["a", "b", "c"]);
  const b = new Set(["b", "c", "d"]);
  assert.equal(jaccard(a, b), 2 / 4);
  assert.equal(jaccard(a, a), 1);
});

test("exact duplicates collapse to highest importance", () => {
  const facts = [
    { ...base, text: "The starter plan costs $29 per month.", importance: 3 },
    { ...base, text: "the starter plan costs $29 per month!", importance: 5 },
  ];
  const out = normalizeFacts(facts);
  assert.equal(out.length, 1);
  assert.equal(out[0].importance, 5);
});

test("near duplicates collapse at 0.85 similarity", () => {
  const facts = [
    { ...base, text: "The starter plan costs twenty nine dollars per month for all users." },
    { ...base, text: "The starter plan costs twenty nine dollars per month for all users", importance: 4 },
  ];
  const out = normalizeFacts(facts);
  assert.equal(out.length, 1);
});

test("distinct facts survive", () => {
  const facts = [
    { ...base, text: "Starter plan costs $29 per month." },
    { ...base, text: "Business plan costs $99 per month." },
    { ...base, text: "Support answers within one business day." },
  ];
  assert.equal(normalizeFacts(facts).length, 3);
});

test("results are ranked by importance descending", () => {
  const facts = [
    { ...base, text: "Minor detail about the office plants collection.", importance: 1 },
    { ...base, text: "Pricing is the single most important fact here.", importance: 5 },
    { ...base, text: "Middle importance fact about workflows.", importance: 3 },
  ];
  const out = normalizeFacts(facts);
  assert.deepEqual(out.map((f) => f.importance), [5, 3, 1]);
});

test("maxPerSource caps facts per URL", () => {
  const facts = Array.from({ length: 10 }, (_, i) => ({
    ...base,
    text: `Unique fact number ${i} with different content entirely.`,
    importance: 3,
  }));
  const out = normalizeFacts(facts, { maxPerSource: 4 });
  assert.equal(out.length, 4);
});

test("minImportance filters trivia", () => {
  const facts = [
    { ...base, text: "An extremely trivial throwaway statement.", importance: 1 },
    { ...base, text: "A genuinely useful operational fact.", importance: 4 },
  ];
  const out = normalizeFacts(facts, { minImportance: 3 });
  assert.equal(out.length, 1);
  assert.equal(out[0].importance, 4);
});
