/**
 * Token 与字数估算。
 *
 * 目的：在调用 AI 之前对上下文体积做出预算，避免超出模型窗口。
 * 方法：中日韩表意文字按每字约 0.68 token 估算，其余字符按每 4 个字符 1 token 估算。
 * 该估算只在本地进行，真实用量以接口返回的 usage 字段为准并覆盖估算值。
 */

const CJK_RANGES: Array<[number, number]> = [
  [0x3000, 0x303f], // 中日韩符号与标点
  [0x3040, 0x30ff], // 日文假名
  [0x3400, 0x4dbf], // 扩展 A
  [0x4e00, 0x9fff], // 基本汉字
  [0xf900, 0xfaff], // 兼容汉字
  [0xff00, 0xffef], // 全角字符
];

/**
 * 计入字数的表意文字范围。
 * 与 CJK_RANGES 的区别在于排除了标点与全角符号，
 * 因此统计字数时标点不会被算成文字。
 */
const CJK_WORD_RANGES: Array<[number, number]> = [
  [0x3040, 0x30ff], // 日文假名
  [0x3400, 0x4dbf], // 扩展 A
  [0x4e00, 0x9fff], // 基本汉字
  [0xf900, 0xfaff], // 兼容汉字
];

function isCjk(code: number): boolean {
  return CJK_RANGES.some(([start, end]) => code >= start && code <= end);
}

function isCjkWord(code: number): boolean {
  return CJK_WORD_RANGES.some(([start, end]) => code >= start && code <= end);
}

const CJK_TOKEN_RATIO = 0.68;
const OTHER_CHARS_PER_TOKEN = 4;

/** 估算文本消耗的 token 数量。 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (isCjk(code)) {
      cjk += 1;
    } else if (!/\s/.test(char)) {
      other += 1;
    }
  }
  return Math.ceil(cjk * CJK_TOKEN_RATIO + other / OTHER_CHARS_PER_TOKEN);
}

/** 统计正文字数：汉字与假名逐字计一，连续的拉丁字母或数字串计一，标点与空白不计入。 */
export function countWords(text: string): number {
  if (!text) return 0;
  let count = 0;
  let inLatinRun = false;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (isCjkWord(code)) {
      count += 1;
      inLatinRun = false;
    } else if (/[A-Za-z0-9]/.test(char)) {
      if (!inLatinRun) {
        count += 1;
        inLatinRun = true;
      }
    } else {
      inLatinRun = false;
    }
  }
  return count;
}

/**
 * 按 token 预算裁剪文本，优先保留开头与结尾。
 * 用于把超长往期章节压缩进上下文。
 */
export function truncateToTokenBudget(text: string, budget: number): string {
  if (budget <= 0) return '';
  if (estimateTokens(text) <= budget) return text;

  const chars = Array.from(text);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const head = Math.ceil(mid * 0.6);
    const tail = mid - head;
    const sample =
      chars.slice(0, head).join('') + (tail > 0 ? chars.slice(chars.length - tail).join('') : '');
    if (estimateTokens(sample) <= budget) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  const head = Math.ceil(low * 0.6);
  const tail = low - head;
  const headText = chars.slice(0, head).join('');
  const tailText = tail > 0 ? chars.slice(chars.length - tail).join('') : '';
  return tail > 0 ? `${headText}\n\n…中略…\n\n${tailText}` : headText;
}
