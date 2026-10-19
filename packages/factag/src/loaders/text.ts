import { Document, Metadata } from "../documents.js";
import { BaseLoader } from "./base.js";
import { htmlToText, looksLikeHtml } from "./html.js";

export type TextFormat = "text" | "html" | "auto";

export interface TextLoaderOptions {
  format?: TextFormat;
  metadata?: Metadata;
}

export class TextLoader extends BaseLoader {
  private content: string;
  private opts: TextLoaderOptions;

  constructor(content: string, opts: TextLoaderOptions = {}) {
    super();
    this.content = content;
    this.opts = opts;
  }

  async load(): Promise<Document[]> {
    const format = this.opts.format ?? "auto";
    const isHtml = format === "html" || (format === "auto" && looksLikeHtml(null, this.content.slice(0, 1000)));
    const text = isHtml ? htmlToText(this.content) : this.content.trim();
    return [new Document({ pageContent: text, metadata: { source: "inline", url: "inline", ...(this.opts.metadata ?? {}) } })];
  }
}
