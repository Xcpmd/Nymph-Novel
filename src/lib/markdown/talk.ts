/**
 * 角色发言标记的解析与文本化处理。
 *
 * 正文中角色发言一律写作 <talk chara="角色名">发言内容</talk>，不写双引号。
 * 本模块提供三种用途的转换：
 * 一，渲染前把标记替换为可被 Markdown 渲染器处理的占位形式，避免标记被清洗掉。
 * 二，导出纯文本时把标记还原为带双引号的对白。
 * 三，统计与检索时把标记剥离，只保留发言内容。
 */

const TALK_PATTERN = /<talk\s+chara="([^"]*)"\s*>([\s\S]*?)<\/talk>/g;

export interface TalkSegment {
  /** 是否为发言片段 */
  talk: boolean;
  /** 发言者为角色名，非发言片段为空串 */
  chara: string;
  text: string;
}

/** 把正文拆成发言与叙述交替的片段序列。 */
export function splitTalkSegments(content: string): TalkSegment[] {
  const segments: TalkSegment[] = [];
  let cursor = 0;
  TALK_PATTERN.lastIndex = 0;
  for (const match of content.matchAll(TALK_PATTERN)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      segments.push({ talk: false, chara: '', text: content.slice(cursor, start) });
    }
    segments.push({ talk: true, chara: (match[1] ?? '').trim(), text: (match[2] ?? '').trim() });
    cursor = start + match[0].length;
  }
  if (cursor < content.length) {
    segments.push({ talk: false, chara: '', text: content.slice(cursor) });
  }
  return segments;
}

/** 取出正文中出现的全部角色名，按首次出现顺序排列。 */
export function collectSpeakers(content: string): string[] {
  const names: string[] = [];
  TALK_PATTERN.lastIndex = 0;
  for (const match of content.matchAll(TALK_PATTERN)) {
    const name = (match[1] ?? '').trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * 把标记转换为纯文本对白。
 *
 * 导出为 txt 或复制到剪贴板时使用，发言加上中文双引号，与纸质排版习惯一致。
 */
export function talkToPlainText(content: string): string {
  return content.replace(TALK_PATTERN, (_, _chara: string, text: string) => {
    const inner = text.trim();
    return inner ? `“${inner}”` : '';
  });
}

/**
 * 把标记转换为 Markdown 行内语法。
 *
 * 渲染前的预处理：统一转成行内代码的变体，既能躲过 HTML 清洗，
 * 又能携带角色名供渲染器着色。使用不可见的私有区字符作为定界符，
 * 避免与正文中可能出现的普通反引号冲突。
 */
const MARK_OPEN = '\uE000';
const MARK_MID = '\uE001';
const MARK_CLOSE = '\uE002';

export { MARK_CLOSE, MARK_MID, MARK_OPEN };

export function talkToMarkedText(content: string): string {
  return content.replace(TALK_PATTERN, (_, chara: string, text: string) => {
    const name = chara.trim().replace(/\s+/g, ' ');
    const inner = text.trim().replace(/\n+/g, ' ');
    if (!inner) return '';
    return `${MARK_OPEN}${name}${MARK_MID}${inner}${MARK_CLOSE}`;
  });
}

/** 判断一段文本是否为转换后的发言片段，是则解析出角色名与内容。 */
export function parseMarkedTalk(text: string): { chara: string; text: string } | null {
  if (!text.startsWith(MARK_OPEN) || !text.endsWith(MARK_CLOSE)) return null;
  const body = text.slice(MARK_OPEN.length, text.length - MARK_CLOSE.length);
  const index = body.indexOf(MARK_MID);
  if (index < 0) return null;
  return { chara: body.slice(0, index), text: body.slice(index + MARK_MID.length) };
}

/** 剥离全部发言标记，仅保留发言内容，用于统计字数与建立检索索引。 */
export function stripTalkMarkers(content: string): string {
  return content.replace(TALK_PATTERN, (_, _chara: string, text: string) => text.trim());
}

/**
 * 剥离生成流程中的控制标记。
 *
 * 步骤清单与步骤完成标记只服务于事件进度判定，查询与调阅标记只服务于设定检索，
 * 它们都不属于正文，展示与保存前必须移除。
 */
export function stripWalkMarkers(content: string): string {
  return content
    .replace(/<step(?:\s+time="[^"]*")?\s*>[\s\S]*?<\/step>/g, '')
    .replace(/<step-status\s+value="(?:done|partial)"\s*>[\s\S]*?<\/step-status>/g, '')
    .replace(/<query>[\s\S]*?<\/query>/g, '')
    .replace(/<recall\s+event="[^"]*"\s*>[\s\S]*?<\/recall>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 依据角色名计算稳定的发言色相。
 *
 * 角色图鉴中已经登记色相时以登记值为准；
 * 未登记的角色按名称哈希得到一个稳定色相，保证同一角色每次渲染颜色一致。
 */
export function hueForSpeaker(name: string): number {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 100003;
  }
  return hash % 360;
}

/**
 * 生成发言行内样式。
 *
 * 色相相同而明暗不同，使颜色在明暗主题下都保持可读。
 * 明暗度通过 CSS 变量切换，这里只负责把色相与饱和度写在元素上。
 */
export function talkStyle(hue: number): React.CSSProperties {
  return {
    ['--talk-hue' as string]: String(hue),
  } as React.CSSProperties;
}
