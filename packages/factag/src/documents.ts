export type Metadata = Record<string, unknown>;

export interface DocumentInput {
  pageContent: string;
  metadata?: Metadata;
}

export class Document {
  pageContent: string;
  metadata: Metadata;

  constructor(input: DocumentInput) {
    this.pageContent = input.pageContent;
    this.metadata = input.metadata ?? {};
  }
}

export interface Fact {
  text: string;
  importance: number;
  category: string;
  sourceUrl: string;
  chunkId?: string;
  metadata?: Metadata;
}

export function createFact(input: Fact): Fact {
  if (!input || typeof input.text !== "string" || !input.text.trim()) {
    throw new Error("createFact: fact.text is required");
  }
  const importance = Number.isFinite(input.importance)
    ? Math.max(1, Math.min(5, Math.round(input.importance)))
    : 3;
  return {
    text: input.text.trim(),
    importance,
    category: String(input.category || "fact").toLowerCase(),
    sourceUrl: typeof input.sourceUrl === "string" && input.sourceUrl ? input.sourceUrl : "unknown",
    ...(input.chunkId ? { chunkId: input.chunkId } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

export function sourceUrlOf(doc: Document): string {
  const raw = doc.metadata.url ?? doc.metadata.source;
  if (typeof raw === "string" && raw.length > 0) return raw;
  return "unknown";
}
