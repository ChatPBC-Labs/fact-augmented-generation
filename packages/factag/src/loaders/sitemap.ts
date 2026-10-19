import { Document, Metadata } from "../documents.js";
import { BaseLoader } from "./base.js";
import { URLLoader, URLOptions } from "./url.js";

export interface SitemapOptions {
  maxPages?: number;
  urlFilter?: (url: string) => boolean;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  loaderOptions?: URLOptions;
  onSkip?: (url: string, error: Error) => void;
}

const LOC = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi;
const SITEMAP_INDEX = /<sitemapindex[\s>]/i;

function parseLocs(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(LOC)) {
    const url = m[1].trim();
    if (url) out.push(url);
  }
  return out;
}

export class SitemapLoader extends BaseLoader {
  private sitemapUrl: string;
  private opts: SitemapOptions;

  constructor(sitemapUrl: string, opts: SitemapOptions = {}) {
    super();
    this.sitemapUrl = sitemapUrl;
    this.opts = opts;
  }

  private async fetchText(url: string): Promise<string> {
    const fetchFn = this.opts.fetchFn ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 15000);
    try {
      const res = await fetchFn(url, { redirect: "follow", signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);
      return await res.text();
    } finally {
      clearTimeout(timer);
    }
  }

  private async discover(sitemapUrl: string, depth: number): Promise<string[]> {
    const xml = await this.fetchText(sitemapUrl);
    const locs = parseLocs(xml);
    if (SITEMAP_INDEX.test(xml) && depth < 2) {
      const nested = await Promise.all(
        locs.map((child) => this.discover(child, depth + 1).catch(() => [] as string[]))
      );
      return nested.flat();
    }
    return locs;
  }

  async load(): Promise<Document[]> {
    const maxPages = this.opts.maxPages ?? 50;
    const filter = this.opts.urlFilter ?? ((url: string) => /^https?:\/\//i.test(url));
    const found = await this.discover(this.sitemapUrl, 0);
    const urls = [...new Set(found.filter(filter))].slice(0, maxPages);
    const docs: Document[] = [];
    for (const url of urls) {
      try {
        const loader = new URLLoader(url, this.opts.loaderOptions ?? {});
        docs.push(...(await loader.load()));
      } catch (err) {
        this.opts.onSkip?.(url, err instanceof Error ? err : new Error(String(err)));
      }
    }
    return docs;
  }
}

export function urlsFromSitemapXml(xml: string): string[] {
  return parseLocs(xml);
}

export function sitemapMetadata(url: string): Metadata {
  return { source: url, url };
}
