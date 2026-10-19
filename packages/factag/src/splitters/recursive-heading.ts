import { Document } from "../documents.js";

export interface RecursiveHeadingSplitterOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  separators?: string[];
}

export const DEFAULT_SEPARATORS = [
  "\n# ",
  "\n## ",
  "\n### ",
  "\n#### ",
  "\n##### ",
  "\n###### ",
  "\n\n",
  "\n",
  " ",
  "",
];

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "root"
  );
}

export class RecursiveHeadingSplitter {
  chunkSize: number;
  chunkOverlap: number;
  private separators: string[];

  constructor(options: RecursiveHeadingSplitterOptions = {}) {
    this.chunkSize = options.chunkSize ?? 1000;
    this.chunkOverlap = options.chunkOverlap ?? 100;
    this.separators = options.separators ?? DEFAULT_SEPARATORS;
    if (this.chunkSize < 1) throw new Error("chunkSize must be >= 1");
    if (this.chunkOverlap < 0 || this.chunkOverlap >= this.chunkSize) {
      throw new Error("chunkOverlap must be >= 0 and < chunkSize");
    }
  }

  private hardSplit(text: string): string[] {
    const out: string[] = [];
    let idx = 0;
    while (idx < text.length) {
      out.push(text.slice(idx, idx + this.chunkSize));
      idx += this.chunkSize;
    }
    return out;
  }

  private recursiveSplit(text: string, separators: string[]): string[] {
    const trimmed = text.trim();
    if (!trimmed) return [];
    if (trimmed.length <= this.chunkSize && separators[0] !== "") {
      const merged = this.mergeSplits([trimmed]);
      return merged;
    }
    if (separators.length === 0) return this.hardSplit(trimmed);
    const [sep, ...rest] = separators;
    if (sep === "") return this.hardSplit(trimmed);
    if (!text.includes(sep)) return this.recursiveSplit(text, rest);
    const pieces = text.split(sep).map((piece, i) => (i === 0 ? piece : sep + piece));
    return this.mergeSplits(pieces, rest);
  }

  private mergeSplits(pieces: string[], rest: string[] = []): string[] {
    const chunks: string[] = [];
    let current = "";
    for (const piece of pieces) {
      if (!piece) continue;
      const candidate = current === "" ? piece : current + piece;
      if (candidate.length <= this.chunkSize) {
        current = candidate;
        continue;
      }
      if (current) chunks.push(current);
      if (piece.length > this.chunkSize && rest.length > 0) {
        chunks.push(...this.recursiveSplit(piece, rest));
        current = "";
      } else {
        current = piece;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  private applyOverlap(chunks: string[]): string[] {
    if (this.chunkOverlap === 0 || chunks.length < 2) return chunks;
    const out: string[] = [chunks[0]];
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1];
      let tail = prev.length <= this.chunkOverlap ? prev : prev.slice(prev.length - this.chunkOverlap);
      const sp = tail.search(/\s/);
      if (sp >= 0 && sp + 1 < tail.length) tail = tail.slice(sp + 1);
      const cur = chunks[i];
      if (tail && !cur.includes(tail) && tail.length + cur.length <= this.chunkSize + this.chunkOverlap) {
        out.push(tail + cur);
      } else {
        out.push(cur);
      }
    }
    return out;
  }

  splitText(text: string): string[] {
    if (!text.trim()) return [];
    const raw = this.recursiveSplit(text, this.separators);
    return this.applyOverlap(raw).filter((c) => c.trim().length > 0);
  }

  splitDocuments(docs: Document[]): Document[] {
    const out: Document[] = [];
    for (const doc of docs) {
      const chunks = this.splitText(doc.pageContent);
      const headingStack: string[] = [];
      let chunkIndex = 0;
      for (const chunk of chunks) {
        for (const line of chunk.split("\n")) {
          const m = line.match(/^(#{1,6})\s+(.*)$/);
          if (m) {
            const level = m[1].length;
            headingStack.length = level - 1;
            headingStack[level - 1] = m[2].trim();
          }
        }
        const heading = headingStack.filter(Boolean).join(" > ");
        out.push(
          new Document({
            pageContent: chunk,
            metadata: {
              ...doc.metadata,
              heading,
              chunkIndex,
              chunkId: `${slug(heading || "root")}#${chunkIndex}`,
            },
          })
        );
        chunkIndex++;
      }
    }
    return out;
  }
}
