// 应用目标的书条目读取：替代 Rust 端的 epub 协议。Playwright 在 e2e/adapter.ts 里拦截
// http://epub.localhost/book/<id>/ 的请求，用这里的函数从 fixtures/<id>.epub 取条目。
// 根地址采用 Windows 桌面版的同一形式，应用的 normalizeEpubRequestUrl 才会原样放行。

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const SUITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const TYPES = {
  ".xhtml": "application/xhtml+xml; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".opf": "application/oebps-package+xml; charset=utf-8",
  ".ncx": "application/x-dtbncx+xml; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

const zips = new Map();

async function loadBook(id) {
  if (!/^[\w-]+$/.test(id)) return null;
  if (!zips.has(id)) {
    try {
      const data = await fs.readFile(path.join(SUITE_ROOT, "fixtures", `${id}.epub`));
      zips.set(id, await JSZip.loadAsync(data));
    } catch {
      return null;
    }
  }
  return zips.get(id);
}

/** 返回 { body, type }，条目不存在时返回 null */
export async function readBookEntry(id, entryName) {
  const zip = await loadBook(id);
  const entry = zip && zip.file(entryName);
  if (!entry) return null;
  return {
    body: await entry.async("nodebuffer"),
    type: TYPES[path.extname(entryName).toLowerCase()] ?? "application/octet-stream",
  };
}
