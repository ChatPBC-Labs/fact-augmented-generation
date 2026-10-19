import { Fact } from "../documents.js";
import { BaseLoader } from "../loaders/base.js";
import { RecursiveHeadingSplitter } from "../splitters/recursive-heading.js";
import { Extractor } from "../extractors/types.js";
import { factKey, NormalizeOptions, normalizeFacts } from "../normalize/dedupe.js";
import { FactStore } from "../stores/types.js";

export type IngestStage = "load" | "split" | "extract" | "normalize" | "store";

export interface IngestProgress {
  stage: IngestStage;
  documents?: number;
  chunks?: number;
  facts?: number;
  kept?: number;
}

export interface IngestOptions {
  loader: BaseLoader;
  splitter?: RecursiveHeadingSplitter;
  extractor: Extractor;
  store: FactStore;
  normalize?: boolean | NormalizeOptions;
  dedupeAcrossRuns?: boolean;
  onProgress?: (progress: IngestProgress) => void;
}

export interface IngestResult {
  documents: number;
  chunks: number;
  facts: number;
  kept: number;
  skippedFromStore: number;
}

export async function runIngest(options: IngestOptions): Promise<IngestResult> {
  const { loader, extractor, store, onProgress } = options;
  const splitter = options.splitter ?? new RecursiveHeadingSplitter();
  const dedupeAcrossRuns = options.dedupeAcrossRuns !== false;

  const documents = await loader.load();
  onProgress?.({ stage: "load", documents: documents.length });

  const chunks = splitter.splitDocuments(documents);
  onProgress?.({ stage: "split", chunks: chunks.length });

  const facts = await extractor.extractDocuments(chunks);
  onProgress?.({ stage: "extract", facts: facts.length });

  const normalizeOptions = typeof options.normalize === "object" ? options.normalize : {};
  const kept =
    options.normalize === false
      ? facts
      : normalizeFacts(facts, normalizeOptions);

  let toAdd = kept;
  let skippedFromStore = 0;
  if (dedupeAcrossRuns) {
    const existing = await store.all();
    const seen = new Set(existing.map(factKey));
    toAdd = kept.filter((f) => {
      const key = factKey(f);
      if (seen.has(key)) {
        skippedFromStore++;
        return false;
      }
      seen.add(key);
      return true;
    });
  }
  onProgress?.({ stage: "normalize", kept: toAdd.length });

  await store.addDocuments(toAdd);
  onProgress?.({ stage: "store", kept: toAdd.length });

  return {
    documents: documents.length,
    chunks: chunks.length,
    facts: facts.length,
    kept: toAdd.length,
    skippedFromStore,
  };
}

export interface IngestPipeline {
  run(): Promise<IngestResult>;
}

export function createIngestPipeline(options: IngestOptions): IngestPipeline {
  return {
    run: () => runIngest(options),
  };
}

export function factsFromDocumentsLike(facts: Fact[]): Fact[] {
  return facts;
}
