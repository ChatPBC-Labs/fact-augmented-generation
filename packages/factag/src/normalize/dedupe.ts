import { Fact } from "../documents.js";

export interface NormalizeOptions {
  similarity?: number;
  minImportance?: number;
  maxPerSource?: number;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(text: string): string[] {
  return normalizeText(text).split(" ").filter(Boolean);
}

function shingleSet(text: string, k = 3): Set<string> {
  const w = words(text);
  const out = new Set<string>();
  if (w.length < k) {
    for (const token of w) out.add(token);
    return out;
  }
  for (let i = 0; i + k <= w.length; i++) out.add(w.slice(i, i + k).join(" "));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const item of small) if (large.has(item)) inter++;
  return inter / (a.size + b.size - inter);
}

function bucketKey(text: string): string {
  const w = words(text).filter((t) => !["the", "a", "an"].includes(t));
  return w[0] ?? "";
}

export function factKey(fact: Fact): string {
  return `${fact.sourceUrl}||${normalizeText(fact.text)}`;
}

export function normalizeFacts(facts: Fact[], options: NormalizeOptions = {}): Fact[] {
  const similarity = options.similarity ?? 0.85;
  const minImportance = options.minImportance ?? 1;
  const maxPerSource = options.maxPerSource ?? Infinity;

  const eligible = facts.filter((f) => f.text.trim().length >= 8 && f.importance >= minImportance);
  const byExact = new Map<string, Fact>();
  for (const fact of eligible) {
    const key = normalizeText(fact.text);
    if (!key) continue;
    const existing = byExact.get(key);
    if (!existing || fact.importance > existing.importance) byExact.set(key, fact);
  }

  const buckets = new Map<string, Fact[]>();
  for (const fact of byExact.values()) {
    const key = bucketKey(fact.text);
    const list = buckets.get(key);
    if (list) list.push(fact);
    else buckets.set(key, [fact]);
  }

  const kept: Fact[] = [];
  for (const list of buckets.values()) {
    const shingles = list.map((f) => shingleSet(f.text));
    const winners: number[] = [];
    for (let i = 0; i < list.length; i++) {
      let duplicate = false;
      for (const wi of winners) {
        if (jaccard(shingles[i], shingles[wi]) >= similarity) {
          duplicate = true;
          if (list[i].importance > list[wi].importance) winners[winners.indexOf(wi)] = i;
          break;
        }
      }
      if (!duplicate) winners.push(i);
    }
    for (const i of winners) kept.push(list[i]);
  }

  const perSource = new Map<string, number>();
  const ranked = kept
    .map((fact, index) => ({ fact, index }))
    .sort((a, b) => b.fact.importance - a.fact.importance || a.index - b.index)
    .map(({ fact }) => fact)
    .filter((fact) => {
      const count = perSource.get(fact.sourceUrl) ?? 0;
      if (count >= maxPerSource) return false;
      perSource.set(fact.sourceUrl, count + 1);
      return true;
    });

  return ranked;
}
