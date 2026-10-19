import { DatabaseSync } from "node:sqlite";
import { Fact } from "../documents.js";
import { BudgetAssembler } from "../retrievers/budget-assembler.js";
import { KeywordRetriever } from "../retrievers/keyword.js";
import { AssemblerOptions } from "../retrievers/types.js";
import { KeywordRetrieverOptions } from "../retrievers/keyword.js";
import { FactStore } from "./types.js";

interface FactRow {
  text: string;
  importance: number;
  category: string;
  source_url: string;
  chunk_id: string | null;
  metadata: string | null;
}

export class SqliteFactStore implements FactStore {
  private db: DatabaseSync;

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS fag_facts (
        seq        INTEGER PRIMARY KEY AUTOINCREMENT,
        text       TEXT NOT NULL,
        importance INTEGER NOT NULL,
        category   TEXT NOT NULL,
        source_url TEXT NOT NULL,
        chunk_id   TEXT,
        metadata   TEXT
      );
      CREATE INDEX IF NOT EXISTS fag_facts_source ON fag_facts(source_url);
    `);
  }

  async addDocuments(facts: Fact[]): Promise<void> {
    const stmt = this.db.prepare(
      "INSERT INTO fag_facts (text, importance, category, source_url, chunk_id, metadata) VALUES (?, ?, ?, ?, ?, ?)"
    );
    for (const fact of facts) {
      stmt.run(
        fact.text,
        fact.importance,
        fact.category,
        fact.sourceUrl,
        fact.chunkId ?? null,
        fact.metadata ? JSON.stringify(fact.metadata) : null
      );
    }
  }

  async all(): Promise<Fact[]> {
    const rows = this.db.prepare("SELECT text, importance, category, source_url, chunk_id, metadata FROM fag_facts ORDER BY seq").all() as unknown as FactRow[];
    return rows.map((row) => ({
      text: row.text,
      importance: Number(row.importance),
      category: row.category,
      sourceUrl: row.source_url,
      ...(row.chunk_id ? { chunkId: row.chunk_id } : {}),
      ...(row.metadata ? { metadata: JSON.parse(row.metadata) as Record<string, unknown> } : {}),
    }));
  }

  async clear(): Promise<void> {
    this.db.exec("DELETE FROM fag_facts");
  }

  async size(): Promise<number> {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM fag_facts").get() as { n?: number } | undefined;
    return Number(row?.n ?? 0);
  }

  close(): void {
    this.db.close();
  }

  asAssembler(options?: AssemblerOptions): BudgetAssembler {
    return new BudgetAssembler(this, options);
  }

  asKeywordRetriever(options?: KeywordRetrieverOptions): KeywordRetriever {
    return new KeywordRetriever(this, options);
  }
}
