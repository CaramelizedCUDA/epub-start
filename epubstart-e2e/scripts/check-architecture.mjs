// 静态架构检查：把 ARCHITECTURE.md:187 的两条硬约束变成能在 CI 里跑的脚本。
//
//   node scripts/check-architecture.mjs                 扫描仓库的 src/
//   node scripts/check-architecture.mjs --root ../src   指定扫描目录
//   node scripts/check-architecture.mjs --self-check    只验证规则本身（内置正反样例），不扫仓库
//
// 规则
//   no-direct-resize       分页模式下不能直接调 rendition.resize()，必须经过 reflow.ts（只有 reflow.ts 豁免）
//   no-doc-root-transform  不能用 top / transform 平移 iframe 文档根元素（会破坏 EPUB.js 的多列坐标）
//   manager-resize (warn)  manager.resize() 和 rendition.resize() 等价，只给警告，不让构建失败
//
// 这是文本级的启发式检查，不是类型分析：它抓“写法”，抓不到“经过变量绕一圈”的调用。
// 误报时，在该行或上一行写  // arch-allow: <规则 id> 原因  即可放行（原因必填，方便以后审计）。
// 注释里提到 rendition.resize() 不会误报：扫描前会先抹掉注释。
// 已知限制：字符串字面量里的同样文字会被当成代码（比如把示例代码写进模板字符串），遇到时用 arch-allow 放行。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- 规则

/** 每条规则：res 里任何一个命中即违规；bad/good 是自检用的正反样例 */
export const RULES = [
  {
    id: "no-direct-resize",
    severity: "error",
    allowIn: [/(^|\/)features\/reader\/engine\/reflow\.ts$/],
    message: "不能直接调用 rendition.resize()，必须经过 reflow.ts 的 preserveAndReflow（ARCHITECTURE.md:187）",
    res: [/\b\w*[Rr]endition\w*(?:\??\.\w+)*?\??\.resize\s*\(/g],
    bad: [
      "rendition.resize(w, h)",
      "this.rendition.resize(w, h);",
      "book.rendition?.resize(w,h)",
      "renditionRef.current?.resize(w, h)",
      "const r = await getRendition(); renditionInstance.resize(1, 2)",
      "rendition.manager.resize(w, h)",
    ],
    good: [
      "window.addEventListener('resize', onResize)",
      "observer.resize(w, h)",
      "await reflow.preserveAndReflow(rendition, opts)",
      "// rendition.resize(w, h)  只是注释",
      "/* rendition.resize(w, h) */",
    ],
  },
  {
    id: "no-doc-root-transform",
    severity: "error",
    message: "分页模式下不能用 top/transform 平移 iframe 文档根元素，会破坏 EPUB.js 的多列坐标（ARCHITECTURE.md:187）",
    res: [
      /\bdocumentElement\s*\.\s*style\s*\.\s*(?:top|transform|translate)\s*=/g,
      /\bdocumentElement\s*\.\s*style\s*\.\s*setProperty\s*\(\s*['"`](?:top|transform|translate)['"`]/g,
      /\.css\s*\(\s*['"`](?:top|transform|translate)['"`]/g,
      /\bhtml['"]?\s*:\s*\{[^}]*\b(?:transform|translate|top)\b\s*:/g,
    ],
    bad: [
      "contents.document.documentElement.style.transform = `translateX(${x}px)`;",
      "doc.documentElement.style.top = '-120px'",
      "doc.documentElement.style.setProperty('transform', 'translateX(1px)')",
      "contents.css('transform', 'translateX(0)')",
      "contents.addStylesheetRules({ html: { transform: 'translateX(0)' } })",
      "contents.addStylesheetRules({\n  html: {\n    position: 'relative',\n    top: '10px',\n  },\n})",
    ],
    good: [
      "container.scrollLeft = x",
      "frame.style.transform = 'none'", // 这条检查只管文档根元素，iframe 元素本身不在此规则内
      "contents.css('font-size', '18px')",
      "contents.addStylesheetRules({ p: { top: '1px' } })",
      "// documentElement.style.transform = 'x'",
    ],
  },
  {
    id: "manager-resize",
    severity: "warn",
    message: "manager.resize() 与 rendition.resize() 等价，同样应该走 reflow.ts",
    allowIn: [/(^|\/)features\/reader\/engine\/reflow\.ts$/],
    res: [/(?:^|[^\w])manager(?:\??\.\w+)*?\??\.resize\s*\(/g],
    bad: ["this.manager.resize(w, h)", "manager?.resize(w, h)"],
    good: ["layoutManager.resize(1,2)", "scrollManager.resize()"],
  },
];

// ---------------------------------------------------------------- 工具

/** 抹掉注释但保留换行，使行号不变；字符串字面量原样保留 */
export function stripComments(src) {
  let out = "";
  let state = null; // null | 'line' | 'block' | 引号字符
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const d = src[i + 1];
    if (state === null) {
      if (c === "/" && d === "/") {
        state = "line";
        out += "  ";
        i++;
      } else if (c === "/" && d === "*") {
        state = "block";
        out += "  ";
        i++;
      } else {
        if (c === '"' || c === "'" || c === "`") state = c;
        out += c;
      }
    } else if (state === "line") {
      if (c === "\n") {
        state = null;
        out += c;
      } else out += " ";
    } else if (state === "block") {
      if (c === "*" && d === "/") {
        state = null;
        out += "  ";
        i++;
      } else out += c === "\n" ? "\n" : " ";
    } else {
      // 字符串
      if (c === "\\") {
        out += c + (d ?? "");
        i++;
      } else {
        if (c === state || (c === "\n" && state !== "`")) state = null;
        out += c;
      }
    }
  }
  return out;
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

/** 找出 src 里的违规；file 用来判断豁免（统一成正斜杠） */
export function scanSource(src, file = "inline.ts") {
  const norm = file.split(path.sep).join("/");
  const raw = src.split("\n");
  const stripped = stripComments(src);
  const found = new Map(); // "line" -> finding；同一行 error 优先于 warn

  for (const rule of RULES) {
    if (rule.allowIn?.some((re) => re.test(norm))) continue;
    for (const re of rule.res) {
      re.lastIndex = 0;
      for (const m of stripped.matchAll(re)) {
        const line = lineOf(stripped, m.index);
        const allowed = [raw[line - 1], raw[line - 2]].some((l) => l && new RegExp(`arch-allow:\\s*${rule.id}\\b\\s*\\S`).test(l));
        if (allowed) continue;
        const prev = found.get(line);
        if (prev && (prev.severity === "error" || rule.severity === "warn")) continue;
        found.set(line, { rule: rule.id, severity: rule.severity, message: rule.message, file: norm, line, snippet: (raw[line - 1] ?? "").trim() });
      }
    }
  }
  return [...found.values()].sort((a, b) => a.line - b.line);
}

function* walk(dir, includeTests) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist" || e.name === "build" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!includeTests && (e.name === "__tests__" || e.name === "__mocks__")) continue;
      yield* walk(p, includeTests);
    } else if (/\.(?:[cm]?[jt]sx?)$/.test(e.name) && !e.name.endsWith(".d.ts")) {
      if (!includeTests && /\.(?:test|spec)\./.test(e.name)) continue;
      yield p;
    }
  }
}

function findSrc() {
  for (const start of [process.cwd(), HERE]) {
    let d = start;
    for (let i = 0; i < 6; i++) {
      const cand = path.join(d, "src");
      if (fs.existsSync(path.join(cand, "features"))) return cand;
      d = path.dirname(d);
    }
  }
  return null;
}

// ---------------------------------------------------------------- 自检

export function selfCheck() {
  const problems = [];
  for (const rule of RULES) {
    for (const s of rule.bad) {
      const hits = scanSource(s, "src/x.ts").filter((f) => f.rule === rule.id);
      if (!hits.length) problems.push(`[${rule.id}] 应该报却没报：${JSON.stringify(s)}`);
    }
    for (const s of rule.good) {
      const hits = scanSource(s, "src/x.ts").filter((f) => f.rule === rule.id);
      if (hits.length) problems.push(`[${rule.id}] 不该报却报了：${JSON.stringify(s)}`);
    }
  }
  // 豁免：reflow.ts 里允许直接 resize；其他文件不行
  if (scanSource("rendition.resize(w, h)", "src/features/reader/engine/reflow.ts").length)
    problems.push("reflow.ts 应当被豁免");
  if (!scanSource("rendition.resize(w, h)", "src/features/reader/engine/other.ts").length)
    problems.push("非 reflow.ts 不该被豁免");
  // 行内放行：必须写原因
  if (scanSource("// arch-allow: no-direct-resize 滚动模式不经过分页\nrendition.resize(w, h)", "src/x.ts").length)
    problems.push("arch-allow（带原因）应当放行");
  if (!scanSource("// arch-allow: no-direct-resize\nrendition.resize(w, h)", "src/x.ts").length)
    problems.push("arch-allow 缺少原因时不该放行");
  // 行号不能因为抹注释而错位
  const f = scanSource("/* a\n b\n c */\nrendition.resize(1, 2)", "src/x.ts")[0];
  if (!f || f.line !== 4) problems.push(`抹注释后行号错位：期望 4，实际 ${f?.line}`);
  // error 优先于 warn（同一行只报一次）
  const both = scanSource("rendition.manager.resize(1, 2)", "src/x.ts");
  if (both.length !== 1 || both[0].severity !== "error") problems.push("同一行 error 应当压过 warn");
  return problems;
}

// ---------------------------------------------------------------- 入口

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes("--self-check")) {
    const problems = selfCheck();
    if (problems.length) {
      console.error("静态规则自检失败：\n" + problems.map((p) => "  - " + p).join("\n"));
      process.exit(1);
    }
    console.log(`静态规则自检通过（${RULES.length} 条规则，正反样例全部符合预期）`);
    process.exit(0);
  }

  const rootArg = args.includes("--root") ? args[args.indexOf("--root") + 1] : null;
  const root = rootArg ? path.resolve(rootArg) : findSrc();
  if (!root || !fs.existsSync(root)) {
    console.error("找不到要扫描的 src/ 目录，请用 --root 指定");
    process.exit(2);
  }
  const findings = [];
  let files = 0;
  for (const file of walk(root, args.includes("--include-tests"))) {
    files++;
    findings.push(...scanSource(fs.readFileSync(file, "utf8"), path.relative(root, file)));
  }
  for (const f of findings) {
    console.log(`${f.severity === "error" ? "ERROR" : "warn "} ${f.file}:${f.line}  [${f.rule}]\n        ${f.snippet}\n        ${f.message}`);
  }
  const errors = findings.filter((f) => f.severity === "error").length;
  console.log(`\n扫描 ${files} 个文件：${errors} 个错误，${findings.length - errors} 个警告`);
  process.exit(errors ? 1 : 0);
}
