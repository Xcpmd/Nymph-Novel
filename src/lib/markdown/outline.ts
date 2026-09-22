/**
 * 手写大纲的步骤推导。
 *
 * AI 生成的大纲会额外交付 `<step>` 步骤区块，推进指针直接依据它建立。
 * 手写大纲没有这层标记，因此需要从文本结构里还原出推进步骤，
 * 否则事件无法逐章推进，正文生成也就失去了骨架。
 *
 * 推导按以下优先级取一种结构，取到就不再往下找：
 * 有序列表、无序列表、小节标题、自然段。
 * 每条取首句作为步骤提要，过长时截断，保证界面上能读得下。
 */

/** 单个推进步骤。 */
export interface DerivedStep {
  title: string;
  detail: string;
  novelTime?: string;
}

/** 步骤提要的最大字符数。 */
const MAX_TITLE_LENGTH = 60;

/** 推导出的步骤数量上限，避免一段长文被切成几十步。 */
const MAX_STEPS = 24;

/** 有序列表行，兼容 1. 1、1) 1）等写法。序号用非捕获组，让第一条捕获就是内容。 */
const ORDERED_ITEM = /^\s{0,3}(?:\d+)\s*[.、)）]\s*(.+?)\s*$/;

/** 无序列表行。 */
const BULLET_ITEM = /^\s{0,3}[-*+]\s+(.+?)\s*$/;

/** 二级到六级标题行。 */
const SECTION_HEADING = /^\s{0,3}#{2,6}\s+(.+?)\s*#*\s*$/;

/** 取首句作为提要，没有句读时截断到限定长度。 */
function toSummary(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return '';
  // 优先在句末标点处断开，让提要读起来是一句完整的话
  const sentence = /^(.{4,}?[。！？；])/.exec(trimmed);
  const candidate = sentence?.[1] ?? trimmed;
  if (candidate.length <= MAX_TITLE_LENGTH) return candidate;
  return `${candidate.slice(0, MAX_TITLE_LENGTH)}…`;
}

/** 从文本中按给定模式逐行收集条目。 */
function collectLines(text: string, pattern: RegExp): string[] {
  const found: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = pattern.exec(line);
    if (match?.[1]) found.push(match[1]);
  }
  return found;
}

/** 取列表项之后的缩进内容作为该步骤的说明。 */
function collectDetails(text: string, pattern: RegExp): string[] {
  const details: string[] = [];
  let current = -1;
  for (const line of text.split(/\r?\n/)) {
    if (pattern.test(line)) {
      details.push('');
      current += 1;
      continue;
    }
    if (current < 0) continue;
    const stripped = line.trim();
    // 空行与新的小节标题不算作上一条的说明
    if (stripped.length === 0 || /^#{1,6}\s/.test(stripped)) continue;
    if (ORDERED_ITEM.test(line) || BULLET_ITEM.test(line)) continue;
    details[current] = details[current] ? `${details[current]}${stripped}` : stripped;
  }
  return details;
}

/**
 * 从手写大纲推导推进步骤。
 *
 * 找不到任何可用结构时按自然段切分，一段都没有则返回空数组，
 * 由调用方决定是提示用户补充内容还是退回 AI 生成。
 */
export function deriveStepsFromOutline(outline: string): DerivedStep[] {
  const text = outline.trim();
  if (text.length === 0) return [];

  const builders: Array<[RegExp, boolean]> = [
    [ORDERED_ITEM, true],
    [BULLET_ITEM, true],
    [SECTION_HEADING, false],
  ];

  for (const [pattern, withDetail] of builders) {
    const items = collectLines(text, pattern);
    // 只有一个条目时说明这不是列表结构，换下一档判断
    if (items.length < 2) continue;
    const details = withDetail ? collectDetails(text, pattern) : [];
    return items.slice(0, MAX_STEPS).map((item, index) => ({
      title: toSummary(item),
      detail: (details[index] ?? '').slice(0, 400),
    }));
  }

  // 没有列表也没有小节，退回到按自然段切分
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  // 首段通常是标题或事件名，不单独成步
  const body = paragraphs.length > 1 ? paragraphs.slice(1) : paragraphs;
  return body.slice(0, MAX_STEPS).map((item) => ({
    title: toSummary(item),
    detail: '',
  }));
}

/**
 * 从手写大纲中推断事件标题。
 *
 * 优先取一级标题，其次取首个非空行，都取不到时给出兜底名称。
 */
export function deriveEventTitle(outline: string, fallback = '手写事件'): string {
  const text = outline.trim();
  if (text.length === 0) return fallback;
  const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m.exec(text);
  const candidate = heading?.[1]?.trim() ?? text.split(/\r?\n/).find((line) => line.trim())?.trim();
  if (!candidate) return fallback;
  return candidate.length > 40 ? `${candidate.slice(0, 40)}…` : candidate;
}
