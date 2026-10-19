// Firewall: the open-source repo must contain ZERO strings from the user's
// commercial stack. Exits non-zero with a report if any hit is found.
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SELF = fileURLToPath(import.meta.url).toLowerCase();

const BANNED = [
  "workers.dev",
  "chatpbc",
  "spinecraft",
  "cepalopro",
  "tsegayemichael483",
  "xo.je",
  "gsk_",
  "sk_free",
  "wrangler",
];

const SKIP_DIRS = new Set(["node_modules", ".git", ".opencode"]);
const SKIP_FILES = new Set(["package-lock.json"]);

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

const hits = [];
let scanned = 0;

for await (const file of walk(ROOT)) {
  const lower = file.toLowerCase();
  if (lower === SELF || lower.endsWith(".lock") || SKIP_FILES.has(path.basename(file))) continue;
  let buf;
  try {
    buf = await readFile(file);
  } catch {
    continue;
  }
  if (buf.includes(0)) continue;
  scanned += 1;
  const text = buf.toString("utf8").toLowerCase();
  for (const needle of BANNED) {
    if (text.includes(needle)) {
      hits.push({ file: path.relative(ROOT, file), needle });
    }
  }
}

if (hits.length > 0) {
  console.error(`FIREWALL FAIL — ${hits.length} hit(s):`);
  for (const hit of hits) console.error(`  ${hit.file}: ${hit.needle}`);
  process.exit(1);
}

console.log(`FIREWALL OK — ${scanned} file(s) scanned, 0 banned strings.`);
