import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { VERSION } from "../dist/index.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("VERSION const matches package.json (the 0.1.5 mistake never repeats)", () => {
  assert.equal(VERSION, pkg.version);
});
