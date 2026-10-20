import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function run(...args) {
  return execFileSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
}

test("factag version prints cli version + core semver", () => {
  const out = run("version");
  assert.match(out, /^factag-cli \d+\.\d+\.\d+ \(core factag \d+\.\d+\.\d+\)/);
});

test("factag help lists commands", () => {
  const out = run("help");
  assert.match(out, /index/);
  assert.match(out, /ask/);
  assert.match(out, /stats/);
});

test("index → stats → ask end-to-end", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "factag-cli-"));
  const doc = path.join(dir, "pricing.md");
  writeFileSync(doc, "# Pricing\nStarter plan costs $29 per month.\n", "utf8");
  const store = path.join(dir, "facts.jsonl");

  const indexed = run("index", dir, "--out", store, "--quiet");
  assert.match(indexed, /^\d+/m);

  const stats = run("stats", "--facts", store);
  assert.match(stats, /facts: 1/);
  assert.match(stats, /pricing/);

  const ask = run("ask", "what does starter cost?", "--facts", store, "--budget", "2000");
  assert.match(ask, /=== VERIFIED FACTS ===/);
  assert.match(ask, /\$29/);
});
