export { Document, createFact, sourceUrlOf } from "./documents.js";
export type { DocumentInput, Metadata, Fact } from "./documents.js";

export * from "./loaders/index.js";
export * from "./splitters/index.js";
export * from "./extractors/index.js";
export * from "./stores/index.js";
export * from "./retrievers/index.js";
export * from "./normalize/index.js";
export * from "./pipeline/index.js";

export const VERSION = "0.1.0";
