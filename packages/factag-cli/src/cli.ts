#!/usr/bin/env node
import { mkdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import {
  BudgetAssembler,
  DirectoryLoader,
  FileFactStore,
  HeuristicExtractor,
  LLMExtractor,
  RecursiveHeadingSplitter,
  TextLoader,
  URLLoader,
  SitemapLoader,
  WatchSession,
  runIngest,
  VERSION,
} from "factag";

const require = createRequire(import.meta.url);
const { version: CLI_VERSION } = require("../package.json") as { version: string };
const BANNER = `factag-cli ${CLI_VERSION} (core factag ${VERSION})`;

interface Args {
  positional: string[];
  flags: Map<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(name, next);
        i++;
      } else {
        flags.set(name, true);
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function str(args: Args, name: string): string | undefined {
  const v = args.flags.get(name);
  return typeof v === "string" ? v : undefined;
}

function num(args: Args, name: string): number | undefined {
  const v = str(args, name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) fail(`--${name} expects a number, got "${v}"`);
  return n;
}

function bool(args: Args, name: string): boolean {
  return args.flags.get(name) === true;
}

function fail(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

const HELP = `${BANNER} — Fact-Augmented Generation CLI

Usage:
  factag index <url|sitemap.xml|path> [options]   ingest a source into a fact store
  factag watch <url|sitemap.xml|path> [options]   live monitor: re-ingest on website change
                                                 [--interval <sec>] [--out <file>] [--prune] [--quiet]
                                                 [--user-agent <ua>]  (browser UA for bot-protected sites)
  factag ask <question> [options]                 assemble the verified-facts context
  factag stats [options]                          show what is in the fact store
  factag export [options]                         dump the fact store
  factag version                                  print version
  factag help                                     show this help

Options (index):
  --out <file>          fact store path (default: facts.jsonl)
  --max-pages <n>       page cap for sitemap sources (default: 50)
  --chunk <n>           chunk size (default: 1000)
  --llm                 use an LLM extractor instead of the heuristic
  --model <name>        LLM model (default: gpt-4o-mini)
  --base-url <url>      OpenAI-compatible endpoint (default: https://api.openai.com/v1)
  --key-env <VAR>       env var holding the LLM key (default: FACTAG_LLM_KEY, then OPENAI_API_KEY)
  --no-normalize        keep raw extracted facts (no dedupe/rank)
  --quiet               no progress output

Options (watch):
  --interval <sec>      poll period in seconds (default: 300, min 5)
  --out <file>          fact store path (default: facts.jsonl)
  --prune               delete facts the website no longer produces
  --chunk <n>           chunk size (default: 1000)
  --llm / --model / --base-url / --key-env   same as index
  Ctrl+C stops watching; every event prints a diff line.

Options (ask / stats / export):
  --facts <file>        fact store path (default: facts.jsonl)
  --budget <n>          context character budget (default: 8000)
  --k <n>               keyword overflow facts to add (default: 0)
  --format <fmt>        export format: json | markdown | text (default: json)

The extracted context prints to stdout — pipe it into any LLM you already use.`;

async function buildLoader(source: string, args: Args): Promise<DirectoryLoader | URLLoader | SitemapLoader | TextLoader> {
  if (/^https?:\/\//i.test(source)) {
    if (/\.xml(\?|$)/i.test(source)) {
      return new SitemapLoader(source, { maxPages: num(args, "max-pages") ?? 50 });
    }
    return new URLLoader(source);
  }
  const info = await stat(resolve(source)).catch(() => null);
  if (!info) {
    if (/^https?:\/\//i.test(source)) return new URLLoader(source);
    fail(`source not found: ${source}`);
  }
  if (info.isDirectory()) return new DirectoryLoader(source);
  if (/\.xml$/i.test(source)) {
    const { readFile } = await import("node:fs/promises");
    const xml = await readFile(resolve(source), "utf8");
    const { urlsFromSitemapXml } = await import("factag");
    const urls = urlsFromSitemapXml(xml).slice(0, num(args, "max-pages") ?? 50);
    const docs = [];
    for (const url of urls) docs.push(...(await new URLLoader(url).load()));
    return new TextLoader(docs.map((d) => d.pageContent).join("\n\n"), { metadata: { url: source } });
  }
  const { readFile } = await import("node:fs/promises");
  const raw = await readFile(resolve(source), "utf8");
  return new TextLoader(raw, { metadata: { url: `file://${resolve(source)}`, source: `file://${resolve(source)}` } });
}

async function buildExtractor(args: Args, quiet: boolean, extractionFailures: string[]) {
  if (!bool(args, "llm")) {
    return new HeuristicExtractor();
  }
  const keyEnv = str(args, "key-env") ?? "FACTAG_LLM_KEY";
  const apiKey = process.env[keyEnv] ?? process.env.OPENAI_API_KEY;
  if (!apiKey) fail(`--llm requires an API key: set ${keyEnv} or OPENAI_API_KEY`);
  return new LLMExtractor({
    apiKey,
    model: str(args, "model"),
    baseUrl: str(args, "base-url"),
    onError: (batch, error) => {
      extractionFailures.push(`batch ${batch}: ${error.message}`);
      if (!quiet) process.stderr.write(`error: extraction batch ${batch} failed: ${error.message}\n`);
    },
  });
}

function buildSplitter(args: Args): RecursiveHeadingSplitter {
  return new RecursiveHeadingSplitter({ chunkSize: num(args, "chunk") ?? 1000, chunkOverlap: 100 });
}

async function commandIndex(source: string | undefined, args: Args): Promise<void> {
  if (!source) fail("index requires a source (url, sitemap.xml, file, or directory)");
  const outPath = resolve(str(args, "out") ?? "facts.jsonl");
  const quiet = bool(args, "quiet");

  const loader = await buildLoader(source, args);
  const splitter = buildSplitter(args);
  const extractionFailures: string[] = [];
  const extractor = await buildExtractor(args, quiet, extractionFailures);

  const store = new FileFactStore(outPath);
  const result = await runIngest({
    loader,
    splitter,
    extractor,
    store,
    normalize: !bool(args, "no-normalize"),
    onProgress: quiet
      ? undefined
      : (p) => {
          if (p.stage === "load") process.stderr.write(`loaded ${p.documents} document(s)\n`);
          if (p.stage === "split") process.stderr.write(`split into ${p.chunks} chunk(s)\n`);
          if (p.stage === "extract") process.stderr.write(`extracted ${p.facts} raw fact(s)\n`);
          if (p.stage === "normalize") process.stderr.write(`kept ${p.kept} fact(s) after normalize\n`);
        },
  });
  const total = await store.size();
  if (!quiet) {
    process.stderr.write(`store: ${outPath} (${total} fact(s) total)\n`);
    process.stderr.write(
      `ingest: docs=${result.documents} chunks=${result.chunks} raw=${result.facts} kept=${result.kept} skipped=${result.skippedFromStore}\n`
    );
  }
  if (extractionFailures.length > 0) {
    const summary = `${extractionFailures.length} extraction batch(es) failed${
      result.facts === 0 ? "; no facts were extracted" : `; ${result.facts} still extracted`
    }. Last error: ${extractionFailures[extractionFailures.length - 1]}`;
    if (result.facts === 0) fail(summary);
    process.stderr.write(`warn: ${summary}\n`);
  }
  process.stdout.write(`${total}\n`);
}

async function loadStore(args: Args): Promise<FileFactStore> {
  const path = resolve(str(args, "facts") ?? "facts.jsonl");
  const store = new FileFactStore(path);
  if ((await store.size()) === 0) {
    const { access } = await import("node:fs/promises");
    const exists = await access(path).then(() => true).catch(() => false);
    if (!exists) fail(`fact store not found: ${path} (run "factag index" first)`);
  }
  return store;
}

async function commandAsk(question: string | undefined, args: Args): Promise<void> {
  const store = await loadStore(args);
  const budget = num(args, "budget") ?? 8000;
  const k = num(args, "k") ?? 0;
  const assembler = new BudgetAssembler(store, { budget });
  const result =
    k > 0 ? await assembler.assemble(question ?? "", { k }) : await assembler.assemble(question);
  if (k > 0 && result.included.length === 0 && question) {
    process.stderr.write(`warn: no facts matched "${question}" — retry without --k to pack the whole store\n`);
  }
  process.stdout.write(result.context);
  if (result.context) process.stdout.write("\n");
}

async function commandStats(args: Args): Promise<void> {
  const store = await loadStore(args);
  const facts = await store.all();
  const byCategory = new Map<string, number>();
  const bySource = new Map<string, number>();
  const byImportance = new Map<number, number>();
  for (const fact of facts) {
    byCategory.set(fact.category, (byCategory.get(fact.category) ?? 0) + 1);
    bySource.set(fact.sourceUrl, (bySource.get(fact.sourceUrl) ?? 0) + 1);
    byImportance.set(fact.importance, (byImportance.get(fact.importance) ?? 0) + 1);
  }
  const top = <T>(m: Map<T, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
  process.stdout.write(`facts: ${facts.length}\n`);
  process.stdout.write(`sources: ${bySource.size}\n`);
  process.stdout.write(`by importance: ${top(byImportance).map(([k, v]) => `${k}:${v}`).join(" ") || "-"}\n`);
  process.stdout.write(`by category: ${top(byCategory).map(([k, v]) => `${k}:${v}`).join(" ") || "-"}\n`);
  for (const [src, count] of top(bySource).slice(0, 10)) {
    process.stdout.write(`  ${count}\t${src}\n`);
  }
}

async function commandExport(args: Args): Promise<void> {
  const store = await loadStore(args);
  const facts = await store.all();
  const format = str(args, "format") ?? "json";
  if (format === "json") {
    process.stdout.write(JSON.stringify(facts, null, 2) + "\n");
    return;
  }
  if (format === "markdown") {
    for (const fact of facts) {
      process.stdout.write(`- (${fact.sourceUrl}) importance=${fact.importance} category=${fact.category} ${fact.text}\n`);
    }
    return;
  }
  if (format === "text") {
    for (const fact of facts) process.stdout.write(fact.text + "\n");
    return;
  }
  fail(`unknown format: ${format}`);
}

async function commandWatch(source: string | undefined, args: Args): Promise<void> {
  if (!source) fail("watch requires a source (url, sitemap.xml, or directory)");
  const outPath = resolve(str(args, "out") ?? "facts.jsonl");
  const quiet = bool(args, "quiet");
  const intervalSec = num(args, "interval") ?? 300;
  if (intervalSec < 5) fail("--interval must be >= 5 seconds");
  const store = new FileFactStore(outPath);
  const splitter = buildSplitter(args);
  const extractionFailures: string[] = [];
  const extractor = await buildExtractor(args, quiet, extractionFailures);
  const userAgent = str(args, "user-agent");
  const headers = userAgent ? { "user-agent": userAgent } : undefined;

  const fmt = () => "  " + new Date().toISOString().slice(11, 19);
  process.stderr.write(`watching ${source} every ${intervalSec}s -> ${outPath}\n`);
  const session = new WatchSession({
    source,
    store,
    splitter,
    extractor,
    intervalMs: intervalSec * 1000,
    pruneStale: bool(args, "prune"),
    headers,
    onEvent: (event) => {
      if (event.kind === "nochange") {
        if (!quiet) process.stderr.write(`${fmt()} no change (hash ${event.hash})\n`);
      } else if (event.kind === "error") {
        process.stderr.write(`${fmt()} error: ${event.error instanceof Error ? event.error.message : String(event.error)}\n`);
      } else {
        const staleNote = event.pruned > 0 ? `, pruned ${event.pruned} stale` : event.removedCandidates.length > 0 ? `, ${event.removedCandidates.length} stale candidate(s) (use --prune to delete)` : "";
        process.stderr.write(
          `${fmt()} WEBSITE CHANGED: +${event.added} new fact(s), ${event.skippedFromStore} unchanged${staleNote}\n`
        );
      }
    },
  });
  session.start();
  process.on("SIGINT", () => {
    session.stop();
    process.stderr.write("\nwatch stopped\n");
    process.exit(0);
  });
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(HELP + "\n");
    return;
  }
  if (command === "version" || command === "--version" || command === "-v") {
    process.stdout.write(BANNER + "\n");
    return;
  }
  if (command === "index") {
    await commandIndex(args.positional[0], args);
    return;
  }
  if (command === "watch") {
    await commandWatch(args.positional[0], args);
    return;
  }
  if (command === "ask") {
    await commandAsk(args.positional.join(" ").trim() || undefined, args);
    return;
  }
  if (command === "stats") {
    await commandStats(args);
    return;
  }
  if (command === "export") {
    await commandExport(args);
    return;
  }
  fail(`unknown command: ${command} (try "factag help")`);
}

mkdir(dirname(resolve("facts.jsonl"))).catch(() => undefined);

for (const stream of [process.stdout, process.stderr]) {
  stream.on?.("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") process.exit(0);
    throw err;
  });
}

main().catch((err) => {
  process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
