import { Document } from "@langchain/core/documents";
import { BaseRetriever } from "@langchain/core/retrievers";
import type { CallbackManagerForRetrieverRun } from "@langchain/core/callbacks/manager";
import { BudgetAssembler, Fact, KeywordRetriever } from "factag";

export interface FactSourceLike {
  all(): Promise<Fact[]>;
}

export interface FagRetrieverOptions {
  budget?: number;
  overflow?: number;
  includeMetadata?: boolean;
}

export class FagRetriever extends BaseRetriever {
  static lc_name() {
    return "FagRetriever";
  }

  lc_namespace = ["factag"];

  private source: FactSourceLike;
  private budget: number;
  private overflow: number;
  private includeMetadata: boolean;

  constructor(source: FactSourceLike, options: FagRetrieverOptions = {}) {
    super();
    this.source = source;
    this.budget = options.budget ?? 8000;
    this.overflow = options.overflow ?? 0;
    this.includeMetadata = options.includeMetadata !== false;
  }

  async _getRelevantDocuments(query: string, _runManager?: CallbackManagerForRetrieverRun): Promise<Document[]> {
    const assembler = new BudgetAssembler(this.source, { budget: this.budget });
    const result = await assembler.assemble(query);
    let facts = [...result.included];
    if (this.overflow > 0 && result.omitted.length > 0) {
      const retriever = new KeywordRetriever({ all: async () => result.omitted }, { k: this.overflow });
      const extra = await retriever.invoke(query);
      const used = new Set(facts.map((f) => f.text));
      facts = facts.concat(extra.filter((f) => !used.has(f.text)));
    }
    return facts.map(
      (fact) =>
        new Document({
          pageContent: fact.text,
          metadata: this.includeMetadata
            ? {
                source: fact.sourceUrl,
                importance: fact.importance,
                category: fact.category,
                ...(fact.chunkId ? { chunkId: fact.chunkId } : {}),
              }
            : {},
        })
    );
  }
}
