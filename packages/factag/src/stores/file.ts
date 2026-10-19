import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Fact } from "../documents.js";
import { BudgetAssembler } from "../retrievers/budget-assembler.js";
import { KeywordRetriever } from "../retrievers/keyword.js";
import { AssemblerOptions } from "../retrievers/types.js";
import { KeywordRetrieverOptions } from "../retrievers/keyword.js";
import { FactStore } from "./types.js";

export interface FileFactStoreOptions {
  autoFlush?: boolean;
}

export class FileFactStore implements FactStore {
  private path: string;
  private autoFlush: boolean;
  private facts: Fact[] = [];
  private loaded = false;

  constructor(path: string, options: FileFactStoreOptions = {}) {
    this.path = resolve(path);
    this.autoFlush = options.autoFlush !== false;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await readFile(this.path, "utf8");
      this.facts = [];
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as Record<string, unknown>;
          if (parsed._type === "fag-store") continue;
          if (typeof parsed.text === "string") this.facts.push(parsed as unknown as Fact);
        } catch {
          continue;
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw err;
      this.facts = [];
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    if (!this.autoFlush) return;
    await mkdir(dirname(this.path), { recursive: true });
    const header = JSON.stringify({ _type: "fag-store", version: 1 });
    const body = this.facts.map((f) => JSON.stringify(f)).join("\n");
    await writeFile(this.path, header + "\n" + body + "\n", "utf8");
  }

  async addDocuments(facts: Fact[]): Promise<void> {
    await this.ensureLoaded();
    this.facts.push(...facts);
    await this.persist();
  }

  async all(): Promise<Fact[]> {
    await this.ensureLoaded();
    return [...this.facts];
  }

  async clear(): Promise<void> {
    this.facts = [];
    this.loaded = true;
    await this.persist();
  }

  async size(): Promise<number> {
    await this.ensureLoaded();
    return this.facts.length;
  }

  async flush(): Promise<void> {
    await this.persist();
  }

  asAssembler(options?: AssemblerOptions): BudgetAssembler {
    return new BudgetAssembler(this, options);
  }

  asKeywordRetriever(options?: KeywordRetrieverOptions): KeywordRetriever {
    return new KeywordRetriever(this, options);
  }

  static async fromDocuments(facts: Fact[], path: string, options?: FileFactStoreOptions): Promise<FileFactStore> {
    const store = new FileFactStore(path, options);
    await store.addDocuments(facts);
    return store;
  }
}
