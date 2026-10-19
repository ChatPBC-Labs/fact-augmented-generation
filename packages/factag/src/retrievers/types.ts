import { Fact } from "../documents.js";

export interface FactSource {
  all(): Promise<Fact[]>;
}

export interface AssemblerOptions {
  budget?: number;
  header?: boolean;
}

export interface AssembleQueryOptions {
  k?: number;
}

export interface AssembleResult {
  context: string;
  included: Fact[];
  omitted: Fact[];
  chars: number;
}
