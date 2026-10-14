// 合成 EPUB 生成器：零依赖（自带 ZIP 写入），输出完全确定（同一份代码在任何机器上生成字节级相同的文件）。
//
//   node scripts/make-fixtures.mjs [outDir]      默认写到 fixtures/
//
// 设计要点
//  - 每段正文以 "§<段号>" 开头：轨迹/快照里 first/last 字段一眼就能看出“这页从第几段开始”，排查时不用对偏移量。
//  - 内容由种子随机数生成，不含任何受版权保护的文本。
//  - 字体：排版结果取决于字体，所以快照只在“打包了同一份字体”时才可靠。
//    把字体放进 fixtures/fonts/（.ttf/.otf/.woff2 都行，建议用 OFL 许可的 Noto Sans SC 子集），
//    本脚本会把它们嵌进每本书并用 @font-face 声明。没有字体文件时照常生成，但会警告，
//    并在 manifest.json 里记下 fonts: []，提醒“此时只有不变量可信，快照不可信”。
//  - 真实 bug 的最小复现书不要放在这里，放 fixtures/regression/，在 matrix.ts 里登记即可。

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------- 随机与文本

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LATIN = (
  "reading paging column layout viewport anchor chapter margin glyph baseline justify hyphen spread " +
  "scroll offset render settle measure width height gap fraction remainder boundary caption figure"
).split(" ");
const CJK = "春夏秋冬风花雪月山水云雨天地人心光影书页墨字行间远近明暗长短轻重古今来去开合起落".split("");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function latin(r, n) {
  let s = "";
  while (s.length < n) s += LATIN[Math.floor(r() * LATIN.length)] + (r() < 0.12 ? ". " : " ");
  return s.trim();
}
function cjk(r, n) {
  let s = "";
  while (s.length < n) {
    s += CJK[Math.floor(r() * CJK.length)];
    const x = r();
    if (x < 0.07) s += "，";
    else if (x < 0.1) s += "。";
  }
  return s;
}

/** 段落编号器：保证整本书里的 § 号唯一递增 */
function numberer() {
  let n = 0;
  return () => `§${++n} `;
}

// ---------------------------------------------------------------- 内容定义

function css(fonts) {
  const face = fonts
    .map(
      (f) =>
        `@font-face { font-family: "E2EFont"; src: url("fonts/${f.name}"); font-weight: normal; font-style: normal; }`,
    )
    .join("\n");
  return `${face}
html, body { font-family: ${fonts.length ? '"E2EFont", ' : ""}serif; line-height: 1.7; }
h1 { font-size: 1.6em; margin: 0 0 0.8em; }
h2 { font-size: 1.25em; margin: 1.2em 0 0.6em; }
p { margin: 0 0 0.8em; text-align: justify; overflow-wrap: anywhere; }
blockquote { margin: 0.8em 1.5em; }
figure { margin: 0 0 1em; }
figcaption { font-size: 0.85em; text-align: center; }
img { max-width: 100%; max-height: 90vh; }
`;
}

function svgImage(w, h, label, hue) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="hsl(${hue},45%,78%)"/>` +
    `<rect x="8" y="8" width="${w - 16}" height="${h - 16}" fill="none" stroke="hsl(${hue},45%,35%)" stroke-width="4"/>` +
    `<text x="${w / 2}" y="${h / 2}" font-size="${Math.max(16, Math.min(w, h) / 8)}" text-anchor="middle" ` +
    `fill="hsl(${hue},45%,25%)">${esc(label)}</text></svg>`
  );
}

/** 每个 fixture 返回 { title, chapters: [{title, body}], images: [{name, data}] } */
const FIXTURES = {
  // 超长单章：测试分页循环、跨很多页的偏移累计、章内小标题/引用/列表
  "long-chapter"() {
    const r = rng(11);
    const num = numberer();
    let body = "<h1>超长单章 Long Chapter</h1>";
    for (let i = 0; i < 160; i++) {
      if (i % 20 === 0 && i > 0) body += `<h2>${num()}小节 ${i / 20}</h2>`;
      if (i === 70) {
        body += "<ol>" + [1, 2, 3, 4, 5].map((k) => `<li>${num()}${latin(r, 60)}</li>`).join("") + "</ol>";
        continue;
      }
      if (i % 25 === 12) {
        body += `<blockquote><p>${num()}${cjk(r, 90)}</p></blockquote>`;
        continue;
      }
      body += `<p>${num()}${i % 2 ? cjk(r, 230) : latin(r, 260)}</p>`;
    }
    return { title: "Long Chapter", chapters: [{ title: "超长单章", body }], images: [] };
  },

  // 很多很短的章节：测试章末不足一页的尾页、章间跳转、几乎空的章节
  "short-chapters"() {
    const r = rng(22);
    const num = numberer();
    const sizes = [[1, 40], [2, 120], [0, 0], [5, 200], [1, 30], [12, 150], [3, 90], [1, 600], [2, 20], [8, 180], [1, 10], [6, 140]];
    const chapters = sizes.map(([paras, chars], i) => {
      let body = `<h1>第 ${i + 1} 章</h1>`;
      for (let k = 0; k < paras; k++) body += `<p>${num()}${k % 2 ? cjk(r, chars) : latin(r, chars)}</p>`;
      return { title: `第 ${i + 1} 章`, body };
    });
    return { title: "Short Chapters", chapters, images: [] };
  },

  // 章首大图：测试图片分页、纯图章节、图文混排、行内小图
  "chapter-top-image"() {
    const r = rng(33);
    const num = numberer();
    const images = [
      { name: "wide.svg", data: svgImage(800, 500, "WIDE 800x500", 200) },
      { name: "tall.svg", data: svgImage(500, 900, "TALL 500x900", 20) },
      { name: "small.svg", data: svgImage(120, 120, "S", 120) },
      { name: "cover.svg", data: svgImage(600, 800, "COVER-ONLY", 300) },
    ];
    const fig = (src, cap) => `<figure><img src="images/${src}" alt="${cap}"/><figcaption>${cap}</figcaption></figure>`;
    const para = (n, c) => `<p>${num()}${c ? cjk(r, n) : latin(r, n)}</p>`;
    const chapters = [
      { title: "宽图开头", body: `<h1>宽图开头</h1>${fig("wide.svg", "wide")}${para(500, false)}${para(500, true)}` },
      { title: "高图开头", body: `<h1>高图开头</h1>${fig("tall.svg", "tall")}${para(300, true)}` },
      { title: "只有一张图", body: fig("cover.svg", "cover") },
      { title: "文中插图", body: `<h1>文中插图</h1>${para(700, false)}${fig("wide.svg", "wide")}${para(700, true)}` },
      { title: "行内小图", body: `<h1>行内小图</h1><p>${num()}${latin(r, 80)} <img src="images/small.svg" alt="s" style="height:1.2em"/> ${cjk(r, 80)}</p>${para(400, false)}` },
      { title: "连续两张图", body: `<h1>连续两张图</h1>${fig("tall.svg", "tall")}${fig("wide.svg", "wide")}${para(200, true)}` },
    ];
    return { title: "Chapter Top Image", chapters, images };
  },

  // 中日文混排：标点、中英数字混排、ruby、行内强调、超长无空格串
  "cjk-mixed"() {
    const r = rng(44);
    const num = numberer();
    const mix = (n) => {
      let s = "";
      while (s.length < n) {
        s += cjk(r, 20 + Math.floor(r() * 30));
        const x = r();
        if (x < 0.3) s += ` ${LATIN[Math.floor(r() * LATIN.length)]} `;
        else if (x < 0.5) s += String(Math.floor(r() * 10000));
        else if (x < 0.6) s += "「" + cjk(r, 8) + "」";
        else if (x < 0.7) s += "（" + cjk(r, 6) + "）";
        else if (x < 0.78) s += "<em>" + cjk(r, 6) + "</em>";
        else if (x < 0.84) s += "<strong>" + LATIN[Math.floor(r() * LATIN.length)] + "</strong>";
        else if (x < 0.9) s += "<ruby>漢<rt>kan</rt></ruby><ruby>字<rt>ji</rt></ruby>";
      }
      return s;
    };
    const chapters = [0, 1, 2, 3].map((i) => {
      let body = `<h1>混排 ${i + 1}</h1>`;
      for (let k = 0; k < 14 + i * 6; k++) body += `<p>${num()}${mix(200 + (k % 5) * 60)}</p>`;
      if (i === 2) body += `<p>${num()}https://example.invalid/${"abcdefghij".repeat(12)}/${cjk(r, 10)}</p>`;
      return { title: `混排 ${i + 1}`, body };
    });
    return { title: "CJK Mixed", chapters, images: [] };
  },
};

export const FIXTURE_IDS = Object.keys(FIXTURES);

// ---------------------------------------------------------------- 打包 EPUB

const xhtml = (title, body) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n` +
  `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN" xml:lang="zh-CN">` +
  `<head><meta charset="utf-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>` +
  `<body>${body}</body></html>\n`;

const FONT_TYPES = { ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2" };

function loadFonts(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => FONT_TYPES[path.extname(f).toLowerCase()])
    .sort()
    .map((name) => ({ name, type: FONT_TYPES[path.extname(name).toLowerCase()], data: fs.readFileSync(path.join(dir, name)) }));
}

function buildEpub(id, def, fonts) {
  const files = [];
  const add = (name, data) => files.push({ name, data: Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8") });

  add("mimetype", "application/epub+zip");
  add(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="utf-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">` +
      `<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>\n`,
  );

  const items = [];
  const spine = [];
  def.chapters.forEach((c, i) => {
    const file = `ch${String(i + 1).padStart(2, "0")}.xhtml`;
    add(`OEBPS/${file}`, xhtml(c.title, c.body));
    items.push(`<item id="c${i + 1}" href="${file}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="c${i + 1}"/>`);
  });
  add("OEBPS/style.css", css(fonts));
  items.push(`<item id="css" href="style.css" media-type="text/css"/>`);
  for (const img of def.images) {
    add(`OEBPS/images/${img.name}`, img.data);
    items.push(`<item id="img-${img.name}" href="images/${img.name}" media-type="image/svg+xml"/>`);
  }
  for (const f of fonts) {
    add(`OEBPS/fonts/${f.name}`, f.data);
    items.push(`<item id="font-${f.name}" href="fonts/${f.name}" media-type="${f.type}"/>`);
  }
  add(
    "OEBPS/nav.xhtml",
    xhtml(
      "目录",
      `<nav epub:type="toc"><ol>${def.chapters
        .map((c, i) => `<li><a href="ch${String(i + 1).padStart(2, "0")}.xhtml">${esc(c.title)}</a></li>`)
        .join("")}</ol></nav>`,
    ),
  );
  items.unshift(`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`);

  const uuid = crypto.createHash("sha1").update("epubstart-e2e/" + id).digest("hex").slice(0, 32).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
  add(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="zh-CN">` +
      `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:uuid:${uuid}</dc:identifier>` +
      `<dc:title>${esc(def.title)}</dc:title><dc:language>zh-CN</dc:language>` +
      `<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata>` +
      `<manifest>${items.join("")}</manifest><spine>${spine.join("")}</spine></package>\n`,
  );
  return zipStore(files);
}

// ---------------------------------------------------------------- ZIP（仅 store，不压缩）

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(buf) >>> 0;
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 固定时间戳（1980-01-01）+ 固定顺序 => 输出字节确定。mimetype 必须是第一个条目且不压缩（OCF 要求）。 */
export function zipStore(entries) {
  const out = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const crc = crc32(e.data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6); // UTF-8 文件名
    lh.writeUInt16LE(0, 8); // store
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0x21, 12); // 1980-01-01
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(e.data.length, 18);
    lh.writeUInt32LE(e.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    out.push(lh, name, e.data);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(e.data.length, 20);
    ch.writeUInt32LE(e.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + e.data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...out, cd, end]);
}

// ---------------------------------------------------------------- 给自检页用

/** 导出章节 HTML + 样式（图片内联成 data URI），供 e2e/selftest 在“模拟 rendition”里验证 fixture 本身 */
export function exportForMock(id) {
  const def = FIXTURES[id]();
  const dataUri = (img) => `data:image/svg+xml;utf8,${encodeURIComponent(img.data)}`;
  const chapters = def.chapters.map((c, i) => {
    let html = c.body;
    for (const img of def.images) html = html.split(`images/${img.name}`).join(dataUri(img));
    return { href: `ch${String(i + 1).padStart(2, "0")}.xhtml`, html };
  });
  return { chapters, css: css([]) };
}

// ---------------------------------------------------------------- 入口

/** 估算正文字数（去标签和空白），仅用于 manifest 里的人读信息 */
const textChars = (def) => def.chapters.reduce((n, c) => n + c.body.replace(/<[^>]*>/g, "").replace(/\s/g, "").length, 0);

export function buildAll(outDir, fontsDir = path.join(ROOT, "fixtures", "fonts")) {
  fs.mkdirSync(outDir, { recursive: true });
  const fonts = loadFonts(fontsDir);
  const manifest = { fonts: fonts.map((f) => f.name), books: [] };
  for (const id of FIXTURE_IDS) {
    const def = FIXTURES[id]();
    const buf = buildEpub(id, def, fonts);
    const file = `${id}.epub`;
    fs.writeFileSync(path.join(outDir, file), buf);
    manifest.books.push({
      id,
      file,
      chapters: def.chapters.length,
      approxTextChars: textChars(def),
      bytes: buf.length,
      sha256: crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16),
    });
  }
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = path.resolve(process.argv[2] ?? path.join(ROOT, "fixtures"));
  const m = buildAll(outDir);
  for (const b of m.books) console.log(`${b.file.padEnd(24)} ${String(b.chapters).padStart(3)} 章  约 ${String(b.approxTextChars).padStart(6)} 字  ${b.sha256}`);
  if (!m.fonts.length) {
    console.warn(
      "\n警告：fixtures/fonts/ 里没有字体文件。不变量检查不受影响，但排版快照会随机器上的系统字体变化，" +
        "不要拿这种环境下生成的快照当基准。",
    );
  }
}
