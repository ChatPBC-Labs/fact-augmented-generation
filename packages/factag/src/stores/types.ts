import { Fact } from "../documents.js";
import { BudgetAssembler } from "../retrievers/budget-assembler.js";
import { KeywordRetriever } from "../retrievers/keyword.js";
import { AssemblerOptions } from "../retrievers/types.js";
import { KeywordRetrieverOptions } from "../retrievers/keyword.js";

export interface FactStore {
  addDocuments(facts: Fact[]): Promise<void>;
  all(): Promise<Fact[]>;
  clear(): Promise<void>;
  size(): Promise<number>;
  asAssembler(options?: AssemblerOptions): BudgetAssembler;
  asKeywordRetriever(options?: KeywordRetrieverOptions): KeywordRetriever;
}
