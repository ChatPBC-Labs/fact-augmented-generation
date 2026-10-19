import { Fact } from "../documents.js";
import { BudgetAssembler } from "../retrievers/budget-assembler.js";
import { KeywordRetriever } from "../retrievers/keyword.js";
import { AssemblerOptions } from "../retrievers/types.js";
import { KeywordRetrieverOptions } from "../retrievers/keyword.js";
import { FactStore } from "./types.js";

export class MemoryFactStore implements FactStore {
  private facts: Fact[];

  constructor(facts: Fact[] = []) {
    this.facts = [...facts];
  }

  async addDocuments(facts: Fact[]): Promise<void> {
    this.facts.push(...facts);
  }

  async all(): Promise<Fact[]> {
    return [...this.facts];
  }

  async clear(): Promise<void> {
    this.facts = [];
  }

  async size(): Promise<number> {
    return this.facts.length;
  }

  asAssembler(options?: AssemblerOptions): BudgetAssembler {
    return new BudgetAssembler(this, options);
  }

  asKeywordRetriever(options?: KeywordRetrieverOptions): KeywordRetriever {
    return new KeywordRetriever(this, options);
  }

  static async fromDocuments(facts: Fact[]): Promise<MemoryFactStore> {
    const store = new MemoryFactStore();
    await store.addDocuments(facts);
    return store;
  }
}
