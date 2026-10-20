import { Fact } from "../documents.js";
import { BaseLoader } from "../loaders/base.js";
import { DirectoryLoader } from "../loaders/directory.js";
import { SitemapLoader } from "../loaders/sitemap.js";
import { URLLoader } from "../loaders/url.js";
import { RecursiveHeadingSplitter } from "../splitters/recursive-heading.js";
import { Extractor } from "../extractors/types.js";
import { factKey } from "../normalize/dedupe.js";
import { runIngest, IngestResult } from "../pipeline/ingest.js";
import { FactStore } from "../stores/types.js";
import type { SqliteFactStore } from "../stores/sqlite.js";

export { FACTAG_USER_AGENT } from "../loaders/url.js";

/** Stable content hash (FNV-1a over whitespace-normalized text). */
export function stableHash(text: string): string {
  const norm = text.replace(/\s+/g, " ").trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export type WatchSource =
  | { type: "url"; url: string }
  | { type: "sitemap"; url: string }
  | { type: "dir"; path: string };

export function normalizeSource(source: string | WatchSource): WatchSource {
  if (typeof source !== "string") return source;
  if (/^https?:\/\//i.test(source)) {
    if (/sitemap\.xml$/i.test(source)) return { type: "sitemap", url: source };
    return { type: "url", url: source };
  }
  return { type: "dir", path: source };
}

function loaderFor(source: WatchSource, headers?: Record<string, string>): BaseLoader {
  switch (source.type) {
    case "url":
      return new URLLoader(source.url, { headers });
    case "sitemap":
      return new SitemapLoader(source.url, headers ? { loaderOptions: { headers } } : {});
    case "dir":
      return new DirectoryLoader(source.path);
  }
}

interface PrunableStore extends FactStore {
  removeWhere?(pred: (f: Fact) => boolean): Promise<number>;
}

export interface PollOptions {
  source: string | WatchSource;
  store: FactStore;
  splitter?: RecursiveHeadingSplitter;
  extractor: Extractor;
  lastHash?: string;
  pruneStale?: boolean;
  dedupeAcrossRuns?: boolean;
  /** extra fetch headers — e.g. a browser user-agent for sites that block non-browser bots */
  headers?: Record<string, string>;
}

export interface PollResult {
  changed: boolean;
  hash: string;
  added: number;
  kept: number;
  skippedFromStore: number;
  removedCandidates: Fact[];
  pruned: number;
  ingest: IngestResult | null;
}

/**
 * One monitoring pass:
 *   1. fetch the source and hash the clean text,
 *   2. if the hash differs from lastHash, run a full ingest,
 *   3. report facts still in the store from this source that the fresh
 *      content no longer produces, optionally pruning them (pruneStale).
 */
export async function pollSource(options: PollOptions): Promise<PollResult> {
  const source = normalizeSource(options.source);
  const splitter = options.splitter ?? new RecursiveHeadingSplitter();

  const first = loaderFor(source, options.headers);
  const documents = await first.load();
  const hash = stableHash(documents.map((d) => d.pageContent).join("\u0000"));
  if (options.lastHash && options.lastHash === hash) {
    return { changed: false, hash, added: 0, kept: 0, skippedFromStore: 0, removedCandidates: [], pruned: 0, ingest: null };
  }

  const ingest = await runIngest({
    loader: first,
    splitter,
    extractor: options.extractor,
    store: options.store,
    dedupeAcrossRuns: options.dedupeAcrossRuns !== false,
  });

  // sources this pass is authoritative for
  const docSources = new Set<string>();
  for (const doc of documents) {
    const md = doc.metadata as Record<string, unknown> | undefined;
    const src = (md && (md.source ?? md.url)) as string | undefined;
    if (src) docSources.add(String(src));
  }

  // fresh fact keys produced by the current content (dry re-extract, no store writes)
  const dryLoader = loaderFor(source, options.headers);
  const dryChunks = splitter.splitDocuments(await dryLoader.load());
  const freshFacts = await options.extractor.extractDocuments(dryChunks);
  const freshKeys = new Set(freshFacts.map(factKey));

  const current = (await options.store.all()).filter((f) => docSources.has(f.sourceUrl));
  const removedCandidates = current.filter((f) => !freshKeys.has(factKey(f)));
  let pruned = 0;
  if (options.pruneStale && removedCandidates.length > 0) {
    const store = options.store as PrunableStore;
    if (typeof store.removeWhere === "function") {
      pruned = await store.removeWhere(
        (f) => docSources.has(f.sourceUrl) && !freshKeys.has(factKey(f)),
      );
    }
  }

  return {
    changed: true,
    hash,
    // IngestResult.kept is already the count of store-NEW facts (cross-run
    // duplicates are excluded and reported as skippedFromStore)
    added: ingest.kept,
    kept: ingest.kept,
    skippedFromStore: ingest.skippedFromStore,
    removedCandidates,
    pruned,
    ingest,
  };
}

export type WatchEvent =
  | { kind: "nochange"; hash: string }
  | { kind: "error"; error: unknown }
  | ({ kind: "change" } & PollResult);

export interface WatchSessionOptions extends Omit<PollOptions, "store"> {
  source: string | WatchSource;
  store: FactStore;
  /** must be >= 5000 â€” be kind to the websites you monitor */
  intervalMs: number;
  onEvent?: (event: WatchEvent) => void;
  signal?: AbortSignal;
}

/** Polls a site on an interval until stopped. Passes never overlap. */
export class WatchSession {
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private lastHash: string | undefined;
  private stopped = false;

  constructor(private options: WatchSessionOptions) {
    if (options.intervalMs < 5000) {
      throw new Error("intervalMs must be >= 5000 (be kind to the websites you monitor)");
    }
  }

  private event(result: PollResult): WatchEvent {
    return result.changed ? { ...result, kind: "change" as const } : { kind: "nochange" as const, hash: result.hash };
  }

  async tick(): Promise<WatchEvent> {
    if (this.busy) return { kind: "error", error: new Error("tick already running") };
    this.busy = true;
    try {
      const result = await pollSource({ ...this.options, lastHash: this.lastHash });
      if (result.changed) this.lastHash = result.hash;
      const ev = this.event(result);
      this.options.onEvent?.(ev);
      return ev;
    } catch (error) {
      this.options.onEvent?.({ kind: "error", error });
      return { kind: "error", error };
    } finally {
      this.busy = false;
    }
  }

  start(): this {
    if (this.stopped) throw new Error("session already stopped");
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.options.intervalMs);
    if (this.options.signal) {
      this.options.signal.addEventListener("abort", () => this.stop(), { once: true });
    }
    return this;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
