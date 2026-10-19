import { Document, Fact, sourceUrlOf } from "../documents.js";
import { Extractor } from "./types.js";

export interface HeuristicExtractorOptions {
  minSentenceLength?: number;
  maxSentenceLength?: number;
  minScore?: number;
  importanceFloor?: number;
}

interface Rule {
  pattern: RegExp;
  score: number;
}

const RULES: Rule[] = [
  { pattern: /[$€£¥]\s?\d|\b\d+(\.\d+)?\s?(usd|eur|gbp)\b|\b\d+(\.\d+)?\s?%\b|per month|per year|\/mo\b|\/yr\b|\$\/|pricing|costs?|price/i, score: 4 },
  { pattern: /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}\b|\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\b/i, score: 2 },
  { pattern: /^[\s\-•*]*[A-Z][A-Za-z0-9&/ .-]{2,40}\s+(is|are|means|refers to|stands for|denotes)\s/i, score: 3 },
  { pattern: /\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/i, score: 3 },
  { pattern: /\bhttps?:\/\/\S+/i, score: 1 },
  { pattern: /\b(must|required|requires|always|never|only|guarantee|guaranteed|warranty|deadline|sla)\b/i, score: 2 },
  { pattern: /\b(maximum|min|max|limit|limitup|up to|starts? at|includes?|available in|supports?)\b/i, score: 2 },
  { pattern: /\b\d+\s?(x|×)\s?\d+\b|\b\d+(ms|s|mb|gb|kb|rpm|tpm|qps|tokens?|words?|pages?|seats?|users?)\b/i, score: 2 },
  { pattern: /\b\d+\b/, score: 1 },
  { pattern: /\b(v[0-9]+\.[0-9]+|[0-9]+\.[0-9]+)\b/, score: 1 },
];

const EMAIL_ONLY = /^[\s\-•*]*[\w.+-]+@[\w-]+\.[a-z]{2,}\s*$/i;

const CATEGORIES: { category: string; pattern: RegExp }[] = [
  { category: "pricing", pattern: /[$€£¥]|\bprice|cost|billing|invoice|refund|subscription|per month|per year|\/mo\b/i },
  { category: "limit", pattern: /\blimit|maximum|min\b|max\b|up to|rpm|quota|credits?|rate limit|capacity|throttl/i },
  { category: "policy", pattern: /\bpolicy|privacy|gdpr|terms|consent|retention|compliance|license/i },
  { category: "contact", pattern: /@|support|contact|email|phone|helpdesk/i },
  { category: "feature", pattern: /\bfeature|support|includes?|integrat|api|sdk|export|import|dashboard/i },
  { category: "deadline", pattern: /\bdeadline|due|by\s+\d{4}-\d{2}-\d{2}|sla|response time|uptime/i },
];

function guessCategory(text: string): string {
  for (const { category, pattern } of CATEGORIES) {
    if (pattern.test(text)) return category;
  }
  return "fact";
}

function splitSentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9$€£•-])/)
    .map((s) => s.replace(/^[\s\-•*]+/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export class HeuristicExtractor implements Extractor {
  private opts: Required<HeuristicExtractorOptions>;

  constructor(options: HeuristicExtractorOptions = {}) {
    this.opts = {
      minSentenceLength: options.minSentenceLength ?? 25,
      maxSentenceLength: options.maxSentenceLength ?? 400,
      minScore: options.minScore ?? 3,
      importanceFloor: options.importanceFloor ?? 1,
    };
  }

  private scoreSentence(sentence: string): number {
    let score = 0;
    for (const rule of RULES) {
      if (rule.pattern.test(sentence)) score += rule.score;
    }
    if (sentence.length < this.opts.minSentenceLength) score -= 2;
    if (sentence.length > this.opts.maxSentenceLength) score -= 2;
    return score;
  }

  private toFact(sentence: string, doc: Document, index: number): Fact | null {
    const score = this.scoreSentence(sentence);
    if (score < this.opts.minScore) return null;
    const importance = Math.min(5, Math.max(this.opts.importanceFloor, Math.floor((score + 3) / 2)));
    const heading = doc.metadata.heading;
    const chunkId = typeof doc.metadata.chunkId === "string" ? doc.metadata.chunkId : undefined;
    return {
      text: sentence,
      importance,
      category: guessCategory(sentence),
      sourceUrl: sourceUrlOf(doc),
      ...(chunkId ? { chunkId } : {}),
      ...(typeof heading === "string" && heading ? { metadata: { heading } } : {}),
    };
  }

  async extractDocuments(docs: Document[]): Promise<Fact[]> {
    const facts: Fact[] = [];
    const seen = new Set<string>();
    for (const doc of docs) {
      const sentences = splitSentences(doc.pageContent);
      for (let i = 0; i < sentences.length; i++) {
        const sentence = sentences[i];
        if (EMAIL_ONLY.test(sentence)) {
          const key = sentence.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            const fact = this.toFact(sentence, doc, i);
            if (fact) facts.push(fact);
          }
          continue;
        }
        const fact = this.toFact(sentence, doc, i);
        if (!fact) continue;
        const key = fact.text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        facts.push(fact);
      }
    }
    return facts;
  }
}
