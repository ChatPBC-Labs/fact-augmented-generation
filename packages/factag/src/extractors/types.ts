import { Document, Fact } from "../documents.js";

export interface Extractor {
  extractDocuments(docs: Document[]): Promise<Fact[]>;
}

export interface ParsedFact {
  text: string;
  importance?: number;
  category?: string;
  chunkIndex?: number;
}

export function coerceImportance(value: unknown, fallback = 3): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(5, Math.max(1, Math.round(n)));
}

export function parseFactJson(content: string): ParsedFact[] {
  let body = content.trim();
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) body = fence[1].trim();
  const start = body.indexOf("{");
  const arrStart = body.indexOf("[");
  const jsonStart = start === -1 ? arrStart : arrStart === -1 ? start : Math.min(start, arrStart);
  if (jsonStart === -1) throw new Error("no JSON found in LLM response");
  const endChar = body[jsonStart] === "[" ? "]" : "}";
  const jsonEnd = body.lastIndexOf(endChar);
  if (jsonEnd <= jsonStart) throw new Error("unterminated JSON in LLM response");
  const parsed = JSON.parse(body.slice(jsonStart, jsonEnd + 1));
  const list = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { facts?: unknown }).facts)
    ? (parsed as { facts: unknown[] }).facts
    : [];
  const out: ParsedFact[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const text = typeof rec.text === "string" ? rec.text.trim() : "";
    if (!text) continue;
    const chunkRaw = typeof rec.chunkIndex === "number" ? rec.chunkIndex : typeof rec.chunkIndex === "string" ? Number(rec.chunkIndex) : NaN;
    out.push({
      text: text.replace(/\s+/g, " "),
      importance: coerceImportance(rec.importance),
      category: typeof rec.category === "string" && rec.category.trim() ? rec.category.trim().toLowerCase() : undefined,
      chunkIndex: Number.isInteger(chunkRaw) && chunkRaw >= 0 ? chunkRaw : undefined,
    });
  }
  return out;
}
