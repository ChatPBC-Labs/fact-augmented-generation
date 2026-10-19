import { Fact } from "../documents.js";
import { AssembleQueryOptions, AssembleResult, AssemblerOptions, FactSource } from "./types.js";
import { topKByQuery } from "./keyword.js";

export const FACTS_HEADER = "=== VERIFIED FACTS ===";
export const FACTS_FOOTER = "=== END VERIFIED FACTS ===";

function formatFact(fact: Fact): string {
  return `- (${fact.sourceUrl}) importance=${fact.importance} category=${fact.category} ${fact.text}`;
}

export class BudgetAssembler {
  private source: FactSource;
  private budget: number;
  private header: boolean;

  constructor(source: FactSource, options: AssemblerOptions = {}) {
    this.source = source;
    this.budget = options.budget ?? 8000;
    this.header = options.header !== false;
    if (this.budget < 64) throw new Error("budget must be >= 64 characters");
  }

  async assemble(query?: string, options?: AssembleQueryOptions): Promise<AssembleResult> {
    const all = [...(await this.source.all())];
    all.sort((a, b) => b.importance - a.importance);
    let facts = all;
    const k = options?.k;
    if (k !== undefined && k > 0) {
      facts = topKByQuery(all, query ?? "", k).sort((a, b) => b.importance - a.importance);
    }
    const open = this.header ? FACTS_HEADER + "\n" : "";
    const close = this.header ? "\n" + FACTS_FOOTER : "";
    let context = open;
    const included: Fact[] = [];
    const omitted: Fact[] = [];
    for (const fact of facts) {
      const line = formatFact(fact) + "\n";
      if (open.length + close.length + (context.length - open.length) + line.length <= this.budget) {
        context += line;
        included.push(fact);
      } else {
        omitted.push(fact);
      }
    }
    if (included.length === 0) {
      return { context: "", included: [], omitted: facts, chars: 0 };
    }
    context += close;
    return { context, included, omitted, chars: context.length };
  }

  async invoke(query?: string, options?: AssembleQueryOptions): Promise<Fact[]> {
    const result = await this.assemble(query, options);
    return result.included;
  }

  async toContext(query?: string, options?: AssembleQueryOptions): Promise<string> {
    const result = await this.assemble(query, options);
    return result.context;
  }
}
