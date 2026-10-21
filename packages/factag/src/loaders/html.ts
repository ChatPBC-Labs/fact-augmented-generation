export interface HtmlToTextOptions {
  removeChrome?: boolean;
}

const DROP_ALWAYS = /<(script|style|head|title|noscript|template|svg|iframe|canvas|form|button|select|textarea)[^>]*>[\s\S]*?<\/\1\s*>/gi;
const DROP_ALWAYS_SELF = /<(hr|br|img|input|meta|link|source|track|wbr|col)\b[^>]*\/?>/gi;
const DROP_CHROME = /<(nav|footer|aside|header|dialog|menu)[^>]*>[\s\S]*?<\/\1\s*>/gi;
const COMMENTS = /<!--[\s\S]*?-->/g;
const HEADING_OPEN = /<h([1-6])[^>]*>/gi;
const HEADING_CLOSE = /<\/h[1-6]\s*>/gi;
const LI_OPEN = /<li[^>]*>/gi;
const BLOCK_CLOSE = /<\/(p|div|section|article|ul|ol|table|tbody|thead|tr|blockquote|pre|figure|figcaption|details|summary|dl|dt|dd)\s*>/gi;
const BLOCK_OPEN = /<(p|div|section|article|ul|ol|table|tbody|thead|tr|blockquote|pre|figure|figcaption|details|summary|dl|dt|dd|td|th|caption)\b[^>]*>/gi;
const ANY_TAG = /<[^>]+>/g;
const TITLE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const META_DESC = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
  pound: "£",
  yen: "¥",
  middot: "·",
  bull: "•",
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

export function extractTitle(html: string): string {
  const m = html.match(TITLE);
  return m ? decodeEntities(m[1]).trim().replace(/\s+/g, " ") : "";
}

export function extractDescription(html: string): string {
  const m = html.match(META_DESC);
  return m ? decodeEntities(m[1]).trim() : "";
}

export function htmlToText(html: string, options: HtmlToTextOptions = {}): string {
  const removeChrome = options.removeChrome !== false;
  let out = html
    .replace(COMMENTS, "")
    .replace(DROP_ALWAYS, "")
    .replace(DROP_ALWAYS_SELF, " ");
  if (removeChrome) out = out.replace(DROP_CHROME, "");
  out = out
    .replace(HEADING_OPEN, (_m, level: string) => `\n${"#".repeat(Number(level))} `)
    .replace(HEADING_CLOSE, "\n")
    .replace(LI_OPEN, "\n- ")
    .replace(BLOCK_CLOSE, "\n")
    .replace(BLOCK_OPEN, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    // inline tags must separate adjacent text nodes ("Product"+"Sep 29" must
    // not fuse into "ProductSep") - drop them to a space, not to empty string
    .replace(ANY_TAG, " ")
    .replace(/&nbsp;/gi, " ");
  out = decodeEntities(out)
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return out;
}

export function looksLikeHtml(contentType: string | null, sample: string): boolean {
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("html") || ct.includes("xhtml")) return true;
  if (ct.includes("markdown") || ct.includes("text/plain")) return false;
  return /^\s*(<!doctype html|<html|<head|<body|<h1|<div|<p>)/i.test(sample);
}
