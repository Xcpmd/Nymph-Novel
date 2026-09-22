/**
 * 文案键自检脚本。
 *
 * 作用：扫描 src 下所有组件里用到的 t('...') 调用，
 * 与 src/lib/i18n/zh.ts 中定义的键做比对，列出缺失项。
 * 运行方式：node scripts/check-i18n.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DICT_FILE = path.join(ROOT, 'src/lib/i18n/zh.ts');

/** 解析 zh.ts，返回全部点分键。按缩进与花括号闭合维护层级栈。 */
function collectKeys(source) {
  const keys = new Set();
  const stack = [];
  const indents = [];

  const popTo = (indent) => {
    while (indents.length > 0 && indents[indents.length - 1] >= indent) {
      indents.pop();
      stack.pop();
    }
  };

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/\/\/.*$/, '');
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    const objectStart = trimmed.match(/^([A-Za-z0-9_]+):\s*\{/);
    if (objectStart) {
      popTo(indent);
      stack.push(objectStart[1]);
      indents.push(indent);
      continue;
    }

    const leaf = trimmed.match(/^([A-Za-z0-9_]+):\s*['"`]/);
    if (leaf) {
      popTo(indent + 1);
      keys.add([...stack, leaf[1]].join('.'));
      continue;
    }

    // 闭合花括号：退出一层
    if (trimmed.startsWith('}')) {
      const closingIndent = indent;
      while (indents.length > 0 && indents[indents.length - 1] >= closingIndent) {
        indents.pop();
        stack.pop();
      }
    }
  }
  return keys;
}

/** 递归收集需要检查的源文件。 */
function collectSources(dir, bucket = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSources(full, bucket);
    } else if (/\.tsx?$/.test(entry.name) && !full.includes(`i18n${path.sep}`)) {
      bucket.push(full);
    }
  }
  return bucket;
}

const dictionary = fs.readFileSync(DICT_FILE, 'utf8');
const defined = collectKeys(dictionary);
const files = collectSources(path.join(ROOT, 'src'));

const missing = new Map();
const dynamicKeys = new Set();
const used = new Set();

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\bt\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
    const key = match[2];
    if (key.includes('${')) {
      dynamicKeys.add(key);
      continue;
    }
    used.add(key);
    if (!defined.has(key)) {
      const list = missing.get(key) ?? [];
      list.push(path.relative(ROOT, file).replace(/\\/g, '/'));
      missing.set(key, list);
    }
  }
}

console.log(`文案键定义数：${defined.size}`);
console.log(`静态引用数：${used.size}`);
console.log(`未被引用的键：${[...defined].filter((key) => !used.has(key)).length}`);
console.log(`缺失的键：${missing.size}`);
for (const [key, sources] of [...missing].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`  ${key}  <- ${sources.join(', ')}`);
}
if (dynamicKeys.size > 0) {
  console.log('动态拼接的键，需要人工确认：');
  for (const key of dynamicKeys) console.log(`  ${key}`);
}

process.exitCode = missing.size > 0 ? 1 : 0;
