import { MARK_CLOSE, MARK_MID, MARK_OPEN } from './talk';

/**
 * 发言标记的 rehype 转换。
 *
 * 正文里的 <talk chara="角色">内容</talk> 在进入渲染前会被 talkToMarkedText
 * 改写成用私有区字符定界的普通文本。本插件在清洗之前把这段文本重新组装成
 * 带 data-chara 的 span 元素，交给 React 组件还原为带双引号并按角色着色的对白。
 *
 * 之所以走 hast 而不是 Markdown 行内语法：行内代码无法跨行，内容里的反引号
 * 还会破坏定界，而小说对白这两种情况都会出现。
 */

/** hast 节点。只声明实际用到的字段，避免引入额外类型依赖。 */
export interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** 不进入的内部标签，其文本保持原样。 */
const OPAQUE_TAGS = new Set(['code', 'pre']);

/** 生成一个发言元素。 */
function createTalkElement(chara: string, text: string): HastNode {
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: ['talk-line'], 'data-chara': chara },
    // 发言统一加上中文双引号，正文里写标记时不带引号
    children: [{ type: 'text', value: `“${text}”` }],
  };
}

/**
 * 把一段含标记的文本拆成文本与发言交替的节点序列。
 *
 * 标记不完整时按普通文本保留，宁可少染一处颜色，也不能吞掉正文。
 * 角色名为空时同样按普通文本处理，避免产出无主的对白。
 */
export function splitMarkedText(value: string): HastNode[] {
  const nodes: HastNode[] = [];
  let cursor = 0;

  while (cursor < value.length) {
    const open = value.indexOf(MARK_OPEN, cursor);
    if (open < 0) {
      nodes.push({ type: 'text', value: value.slice(cursor) });
      break;
    }
    if (open > cursor) {
      nodes.push({ type: 'text', value: value.slice(cursor, open) });
    }

    const mid = value.indexOf(MARK_MID, open + MARK_OPEN.length);
    const close = mid < 0 ? -1 : value.indexOf(MARK_CLOSE, mid + MARK_MID.length);
    if (mid < 0 || close < 0) {
      nodes.push({ type: 'text', value: value.slice(open) });
      break;
    }

    const chara = value.slice(open + MARK_OPEN.length, mid).trim();
    const text = value.slice(mid + MARK_MID.length, close).trim();
    if (chara && text) nodes.push(createTalkElement(chara, text));

    cursor = close + MARK_CLOSE.length;
  }

  return nodes;
}

/** 递归替换整棵树里的发言标记。 */
export function transformTalkMarkers(node: HastNode): void {
  if (!node.children || node.children.length === 0) return;
  if (node.type === 'element' && node.tagName && OPAQUE_TAGS.has(node.tagName)) return;

  const next: HastNode[] = [];
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string' && child.value.includes(MARK_OPEN)) {
      next.push(...splitMarkedText(child.value));
      continue;
    }
    transformTalkMarkers(child);
    next.push(child);
  }
  node.children = next;
}

/**
 * rehype 插件入口，需在 rehype-sanitize 之前挂载。
 *
 * 参数类型放宽为 unknown，是为了贴合 unified 对插件的签名要求，
 * 树的结构由 transformTalkMarkers 自行收窄。
 */
export function rehypeTalkMarkers(): (tree: unknown) => void {
  return (tree: unknown): void => {
    transformTalkMarkers(tree as HastNode);
  };
}
