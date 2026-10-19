import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Document, Metadata } from "../documents.js";
import { BaseLoader } from "./base.js";
import { htmlToText } from "./html.js";

const DEFAULT_EXTENSIONS = [".md", ".markdown", ".txt", ".html", ".htm"];

export interface DirectoryLoaderOptions {
  extensions?: string[];
  recursive?: boolean;
  maxFiles?: number;
  metadata?: Metadata;
}

function isHtmlPath(path: string): boolean {
  const ext = extname(path).toLowerCase();
  return ext === ".html" || ext === ".htm";
}

export class DirectoryLoader extends BaseLoader {
  private dirPath: string;
  private opts: DirectoryLoaderOptions;

  constructor(dirPath: string, opts: DirectoryLoaderOptions = {}) {
    super();
    this.dirPath = resolve(dirPath);
    this.opts = opts;
  }

  private async walk(dir: string, out: string[]): Promise<void> {
    const maxFiles = this.opts.maxFiles ?? 500;
    if (out.length >= maxFiles) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (this.opts.recursive !== false && !entry.name.startsWith(".")) {
          await this.walk(full, out);
        }
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  }

  async load(): Promise<Document[]> {
    const extensions = (this.opts.extensions ?? DEFAULT_EXTENSIONS).map((e) => e.toLowerCase());
    const info = await stat(this.dirPath);
    const files: string[] = [];
    if (info.isFile()) {
      files.push(this.dirPath);
    } else {
      await this.walk(this.dirPath, files);
    }
    const selected = files.filter((f) => extensions.includes(extname(f).toLowerCase()));
    const docs: Document[] = [];
    for (const path of selected) {
      const raw = await readFile(path, "utf8");
      const content = isHtmlPath(path) ? htmlToText(raw) : raw.trim();
      if (!content) continue;
      const fileUrl = pathToFileURL(path).href;
      docs.push(
        new Document({
          pageContent: content,
          metadata: {
            source: fileUrl,
            url: fileUrl,
            title: basename(path),
            ...(this.opts.metadata ?? {}),
          },
        })
      );
    }
    return docs;
  }
}
