import { Document, Metadata } from "../documents.js";
import { BaseLoader } from "./base.js";
import { extractDescription, extractTitle, htmlToText, looksLikeHtml } from "./html.js";

export const FACTAG_USER_AGENT = "FactAugmentedGeneration/0.1 (+https://github.com/qfg5182-ui/fact-augmented-generation)";

export interface URLOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  removeChrome?: boolean;
  metadata?: Metadata;
  fetchFn?: typeof fetch;
}

export class URLLoader extends BaseLoader {
  private url: string;
  private opts: URLOptions;

  constructor(url: string, opts: URLOptions = {}) {
    super();
    this.url = url;
    this.opts = opts;
  }

  async load(): Promise<Document[]> {
    const fetchFn = this.opts.fetchFn ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 15000);
    try {
      const res = await fetchFn(this.url, {
        headers: { "user-agent": FACTAG_USER_AGENT, ...(this.opts.headers ?? {}) },
        redirect: "follow",
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} loading ${this.url}`);
      const body = await res.text();
      const contentType = res.headers?.get?.("content-type") ?? null;
      if (looksLikeHtml(contentType, body.slice(0, 500))) {
        const metadata: Metadata = {
          source: this.url,
          url: this.url,
          title: extractTitle(body),
          description: extractDescription(body),
          ...(this.opts.metadata ?? {}),
        };
        return [new Document({ pageContent: htmlToText(body, { removeChrome: this.opts.removeChrome !== false }), metadata })];
      }
      return [
        new Document({
          pageContent: body.trim(),
          metadata: { source: this.url, url: this.url, ...(this.opts.metadata ?? {}) },
        }),
      ];
    } finally {
      clearTimeout(timer);
    }
  }
}
