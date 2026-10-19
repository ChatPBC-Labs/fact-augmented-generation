import { Document, Fact, sourceUrlOf } from "../documents.js";
import { Extractor, ParsedFact, coerceImportance, parseFactJson } from "./types.js";
import { tokenize } from "../retrievers/keyword.js";

function bestDocForText(text: string, docs: Document[]): Document {
  const factTokens = new Set(tokenize(text));
  let best = docs[0];
  let bestScore = -1;
  for (const doc of docs) {
    const docTokens = new Set(tokenize(doc.pageContent));
    let score = 0;
    for (const token of factTokens) if (docTokens.has(token)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = doc;
    }
  }
  return best;
}

export interface LLMExtractorOptions {
  baseUrl?: string;
  apiKey: string;
  model?: string;
  batchSize?: number;
  concurrency?: number;
  maxRetries?: number;
  temperature?: number;
  importanceFloor?: number;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  systemPrompt?: string;
  onError?: (batchIndex: number, error: Error) => void;
}

export const DEFAULT_LLM_SYSTEM_PROMPT = [
  "You are a fact extraction engine for Fact-Augmented Generation (FAG).",
  "You receive numbered text chunks from a knowledge corpus and must extract standalone facts.",
  "Rules:",
  "- Each fact is 1-3 sentences, self-contained, present tense, no pronouns referring to the page.",
  "- Never merge facts from different chunks. Never invent information not in the chunks.",
  "- importance: 5 identity/pricing/limits, 4 capabilities, 3 procedures, 2 background, 1 trivia.",
  "- category: one lowercase slug like pricing, feature, policy, limit, contact, deadline, fact.",
  "- chunkIndex: the 0-based index of the chunk the fact came from.",
  '- Respond ONLY with JSON: {"facts":[{"text":"...","importance":4,"category":"feature","chunkIndex":0}]}',
  'If a chunk has no extractable facts, return {"facts":[]} for it.',
].join("\n");

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

function buildUserPrompt(docs: Document[]): string {
  const parts: string[] = [];
  docs.forEach((doc, i) => {
    const heading = typeof doc.metadata.heading === "string" && doc.metadata.heading ? doc.metadata.heading : "root";
    const url = sourceUrlOf(doc);
    const content = doc.pageContent.length > 6000 ? doc.pageContent.slice(0, 6000) + "\n…(truncated)" : doc.pageContent;
    parts.push(`--- CHUNK ${i} | source: ${url} | heading: ${heading} ---\n${content}`);
  });
  return parts.join("\n\n");
}

function factFromParsed(parsed: ParsedFact, doc: Document, floor: number): Fact | null {
  const importance = coerceImportance(parsed.importance, 3);
  if (importance < floor) return null;
  const heading = doc.metadata.heading;
  const chunkId = typeof doc.metadata.chunkId === "string" ? doc.metadata.chunkId : undefined;
  return {
    text: parsed.text,
    importance,
    category: parsed.category ?? "fact",
    sourceUrl: sourceUrlOf(doc),
    ...(chunkId ? { chunkId } : {}),
    ...(typeof heading === "string" && heading ? { metadata: { heading } } : {}),
  };
}

export class LLMExtractor implements Extractor {
  private opts: Required<Pick<LLMExtractorOptions, "baseUrl" | "apiKey" | "model" | "batchSize" | "concurrency" | "maxRetries" | "temperature" | "importanceFloor" | "timeoutMs" | "systemPrompt">> &
    LLMExtractorOptions;

  constructor(options: LLMExtractorOptions) {
    if (!options.apiKey) throw new Error("LLMExtractor requires an apiKey");
    this.opts = {
      ...options,
      baseUrl: options.baseUrl ?? "https://api.openai.com/v1",
      apiKey: options.apiKey,
      model: options.model ?? "gpt-4o-mini",
      batchSize: options.batchSize ?? 3,
      concurrency: options.concurrency ?? 2,
      maxRetries: options.maxRetries ?? 2,
      temperature: options.temperature ?? 0,
      importanceFloor: options.importanceFloor ?? 2,
      timeoutMs: options.timeoutMs ?? 60000,
      systemPrompt: options.systemPrompt ?? DEFAULT_LLM_SYSTEM_PROMPT,
    };
  }

  private async callModel(messages: ChatMessage[]): Promise<string> {
    const fetchFn = this.opts.fetchFn ?? fetch;
    const url = this.opts.baseUrl.replace(/\/+$/, "") + "/chat/completions";
    let lastError: Error = new Error("LLM call failed");
    for (let attempt = 0; attempt <= this.opts.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
      try {
        const res = await fetchFn(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.opts.apiKey}`,
          },
          body: JSON.stringify({
            model: this.opts.model,
            temperature: this.opts.temperature,
            messages,
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          lastError = new Error(`LLM HTTP ${res.status}: ${body.slice(0, 300)}`);
          if (res.status === 429 || res.status >= 500) {
            await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
            continue;
          }
          throw lastError;
        }
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== "string" || !content) throw new Error("LLM response missing content");
        return content;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.opts.maxRetries) {
          await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
          continue;
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }

  private async extractBatch(batch: Document[], batchIndex: number): Promise<Fact[]> {
    try {
      const content = await this.callModel([
        { role: "system", content: this.opts.systemPrompt },
        { role: "user", content: buildUserPrompt(batch) },
      ]);
      const parsed = parseFactJson(content);
      const facts: Fact[] = [];
      for (const item of parsed) {
        const claimed = item.chunkIndex as number | undefined;
        const doc =
          typeof claimed === "number" && Number.isInteger(claimed) && claimed >= 0 && claimed < batch.length
            ? batch[claimed]
            : bestDocForText(item.text, batch);
        const fact = factFromParsed(item, doc, this.opts.importanceFloor);
        if (fact) facts.push(fact);
      }
      return facts;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (this.opts.onError) {
        this.opts.onError(batchIndex, error);
        return [];
      }
      throw error;
    }
  }

  async extractDocuments(docs: Document[]): Promise<Fact[]> {
    const batches: Document[][] = [];
    for (let i = 0; i < docs.length; i += this.opts.batchSize) {
      batches.push(docs.slice(i, i + this.opts.batchSize));
    }
    if (batches.length === 0) return [];
    const results: Fact[][] = new Array(batches.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(this.opts.concurrency, batches.length) }, async () => {
      while (next < batches.length) {
        const index = next++;
        results[index] = await this.extractBatch(batches[index], index);
      }
    });
    await Promise.all(workers);
    return results.flat();
  }
}
