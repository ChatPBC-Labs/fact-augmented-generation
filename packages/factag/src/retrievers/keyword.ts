import { Fact } from "../documents.js";
import { FactSource } from "./types.js";

export interface KeywordRetrieverOptions {
  k?: number;
}

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "of", "to", "in", "on", "at", "for",
  "and", "or", "but", "it", "its", "this", "that", "these", "those", "with", "from", "by", "as",
  "do", "does", "did", "what", "which", "who", "whom", "how", "when", "where", "why", "can",
  "could", "should", "would", "will", "shall", "may", "might", "must", "i", "you", "he", "she",
  "we", "they", "them", "his", "her", "our", "your", "my", "me", "us",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function topKByQuery(facts: Fact[], query: string, k: number): Fact[] {
  const queryTokens = tokenize(query);
  if (k <= 0 || facts.length === 0) return [];
  if (queryTokens.length === 0) {
    return [...facts]
      .sort((a, b) => b.importance - a.importance)
      .slice(0, k);
  }
  const scored = facts.map((fact, index) => {
    const text = fact.text.toLowerCase();
    let score = 0;
    for (const token of queryTokens) {
      if (new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)) score++;
    }
    return { fact, score, index };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.fact.importance - a.fact.importance || a.index - b.index)
    .slice(0, k)
    .map((s) => s.fact);
}

export class KeywordRetriever {
  private source: FactSource;
  private k: number;

  constructor(source: FactSource, options: KeywordRetrieverOptions = {}) {
    this.source = source;
    this.k = options.k ?? 8;
  }

  async invoke(query: string): Promise<Fact[]> {
    const facts = await this.source.all();
    return topKByQuery(facts, query, this.k);
  }
}
