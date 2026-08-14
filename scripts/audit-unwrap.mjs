#!/usr/bin/env node
/**
 * audit-unwrap.mjs — 统计 src-tauri/src 下 Rust 源码中的 `.unwrap()` 数量。
 *
 * 口径：与 BACKEND_AUDIT.md 一致 ——
 *   - 匹配行数：包含 `.unwrap()` 调用的源码行数（一行多次调用只算一行）
 *   - 总调用次数：`.unwrap()` 出现的总次数
 *
 * 用法：
 *   node scripts/audit-unwrap.mjs           # 仅输出统计
 *   node scripts/audit-unwrap.mjs --check   # 输出并对比文档数字，不一致时 exit 1
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 只统计仓库源码。扫描 src-tauri/ 会把 target/ 下的生成代码计入结果，
// 导致统计随本机构建缓存变化，无法作为可重复的审计证据。
const SRC = join(ROOT, 'src-tauri', 'src');
const PATTERN = /\.unwrap\(\)/g;

/** 递归收集所有 .rs 文件 */
function collectRsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collectRsFiles(full));
    } else if (name.endsWith('.rs')) {
      out.push(full);
    }
  }
  return out;
}

/** 统计匹配行数与总调用次数 */
function countUnwrap(files) {
  let matchLines = 0;
  let totalCalls = 0;
  const perFile = [];
  for (const file of files) {
    const content = readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    let fileLines = 0;
    let fileCalls = 0;
    for (const line of lines) {
      const matches = line.match(PATTERN);
      if (matches) {
        fileLines += 1;
        fileCalls += matches.length;
      }
    }
    if (fileLines > 0) {
      perFile.push({ file: file.slice(ROOT.length + 1), lines: fileLines, calls: fileCalls });
      matchLines += fileLines;
      totalCalls += fileCalls;
    }
  }
  return { matchLines, totalCalls, perFile };
}

/** 从文档中提取已登记的 "N 行（共 M 次调用）" 数字 */
function readDocumented() {
  const docFiles = ['BACKEND_AUDIT.md', 'TODO.md'].map((f) => join(ROOT, f));
  const found = [];
  for (const f of docFiles) {
    try {
      const text = readFileSync(f, 'utf-8');
      const re = /(\d+)\s*行\s*[（(]共\s*(\d+)\s*次调用[)）]/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        found.push({ file: f.slice(ROOT.length + 1), lines: Number(m[1]), calls: Number(m[2]) });
      }
    } catch {
      /* 文件不存在则跳过 */
    }
  }
  return found;
}

const files = collectRsFiles(SRC);
const { matchLines, totalCalls, perFile } = countUnwrap(files);

console.log(`Rust 文件数      : ${files.length}`);
console.log(`匹配行数         : ${matchLines}`);
console.log(`总调用次数       : ${totalCalls}`);
console.log(`(口径：按"包含 .unwrap() 调用的源码行"统计，与 BACKEND_AUDIT.md 一致)`);
console.log('');
console.log('Top 文件分布:');
for (const p of perFile.sort((a, b) => b.calls - a.calls).slice(0, 8)) {
  console.log(`  ${p.file}: ${p.lines} 行 / ${p.calls} 次`);
}

if (process.argv.includes('--check')) {
  console.log('');
  const doc = readDocumented();
  if (doc.length === 0) {
    console.log('[check] 文档中未找到 "N 行（共 M 次调用）" 格式的登记，跳过对比。');
  } else {
    let ok = true;
    for (const d of doc) {
      const match = d.lines === matchLines && d.calls === totalCalls;
      if (!match) ok = false;
      console.log(`[check] ${d.file} 登记 ${d.lines} 行/${d.calls} 次 -> ${match ? '一致 ✓' : `不一致 ✗ (实际 ${matchLines} 行/${totalCalls} 次)`}`);
    }
    if (!ok) {
      console.log('[check] 文档数字与代码不一致，请同步后再提交。');
      process.exit(1);
    }
    console.log('[check] 全部一致。');
  }
}
