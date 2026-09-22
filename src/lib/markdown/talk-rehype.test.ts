import { describe, expect, it } from 'vitest';
import { MARK_CLOSE, MARK_MID, MARK_OPEN, talkToMarkedText } from './talk';
import { splitMarkedText, transformTalkMarkers, type HastNode } from './talk-rehype';

/**
 * 发言标记的 rehype 转换测试。
 *
 * 这一层是渲染的关键路径：标记文本只有在这里被换成 span 元素，
 * 界面才会显示带双引号并按角色着色的对白。此前缺少这层转换，
 * 私有区字符会作为普通文本留在段落里，既不显示引号也不上色。
 */

/** 把标记文本包成一段，便于单独测试拆分。 */
function mark(name: string, text: string): string {
  return `${MARK_OPEN}${name}${MARK_MID}${text}${MARK_CLOSE}`;
}

/** 从节点里取出发言元素的纯文本。 */
function talkText(node: HastNode): string {
  return (node.children ?? []).map((child) => child.value ?? '').join('');
}

describe('splitMarkedText', () => {
  it('把单个发言拆成前文、发言、后文', () => {
    const nodes = splitMarkedText(`他推开门。${mark('陨星', '现在不怕了？')}屋里没点灯。`);

    expect(nodes.length).toBe(3);
    expect(nodes[0]).toEqual({ type: 'text', value: '他推开门。' });
    expect(nodes[1]!.tagName).toBe('span');
    expect(nodes[1]!.properties?.['data-chara']).toBe('陨星');
    expect(talkText(nodes[1]!)).toBe('“现在不怕了？”');
    expect(nodes[2]).toEqual({ type: 'text', value: '屋里没点灯。' });
  });

  it('发言文本带上中文双引号', () => {
    const nodes = splitMarkedText(mark('阿禾', '别回头'));
    expect(talkText(nodes[0]!)).toBe('“别回头”');
  });

  it('发言元素带 talk-line 类名供样式与开关使用', () => {
    const nodes = splitMarkedText(mark('甲', '走'));
    expect(nodes[0]!.properties?.className).toEqual(['talk-line']);
  });

  it('连续两段发言都转成元素', () => {
    const nodes = splitMarkedText(`${mark('甲', '先走')}${mark('乙', '等一下')}`);
    expect(nodes.length).toBe(2);
    expect(nodes.map((node) => node.properties?.['data-chara'])).toEqual(['甲', '乙']);
  });

  it('没有标记时原样返回单段文本', () => {
    const nodes = splitMarkedText('只有叙述。');
    expect(nodes).toEqual([{ type: 'text', value: '只有叙述。' }]);
  });

  it('角色名为空时按普通文本保留', () => {
    const nodes = splitMarkedText(mark('', '无主对白'));
    expect(nodes.every((node) => node.type === 'text')).toBe(true);
  });

  it('发言内容为空时不产出元素', () => {
    const nodes = splitMarkedText(`${mark('甲', '')}后面`);
    expect(nodes.some((node) => node.tagName === 'span')).toBe(false);
  });

  it('标记不完整时按普通文本保留，不吞掉正文', () => {
    const broken = `前文${MARK_OPEN}甲${MARK_MID}没闭合`;
    const nodes = splitMarkedText(broken);
    const joined = nodes.map((node) => node.value ?? '').join('');
    expect(joined).toContain('没闭合');
  });
});

describe('transformTalkMarkers', () => {
  /** 构造一个段落节点的 hast 树。 */
  const paragraph = (value: string): HastNode => ({
    type: 'root',
    children: [{ type: 'element', tagName: 'p', children: [{ type: 'text', value }] }],
  });

  it('替换段落文本里的发言标记', () => {
    const tree = paragraph(`他问：${mark('陨星', '现在不怕了？')}`);
    transformTalkMarkers(tree);

    const inner = tree.children?.[0]?.children ?? [];
    expect(inner.length).toBe(2);
    expect(inner[1]!.tagName).toBe('span');
    expect(inner[1]!.properties?.['data-chara']).toBe('陨星');
  });

  it('嵌套结构里的标记也能被替换', () => {
    const tree: HastNode = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'blockquote',
          children: [
            {
              type: 'element',
              tagName: 'p',
              children: [{ type: 'text', value: mark('乙', '也好') }],
            },
          ],
        },
      ],
    };
    transformTalkMarkers(tree);

    const span = tree.children?.[0]?.children?.[0]?.children?.[0];
    expect(span?.tagName).toBe('span');
  });

  it('不进入代码块，代码里的尖括号标记保持原样', () => {
    const tree: HastNode = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'code',
          children: [{ type: 'text', value: mark('甲', '不该被染色') }],
        },
      ],
    };
    transformTalkMarkers(tree);

    const text = tree.children?.[0]?.children?.[0];
    expect(text?.type).toBe('text');
    expect(text?.value).toContain('不该被染色');
  });

  it('正文经标记转换后整体走通', () => {
    // 模拟真实链路：正文 → talkToMarkedText → rehype 转换
    const marked = talkToMarkedText('他问。<talk chara="陨星">现在不怕了？</talk>');
    const tree = paragraph(marked);
    transformTalkMarkers(tree);

    const inner = tree.children?.[0]?.children ?? [];
    const span = inner.find((node) => node.tagName === 'span');
    expect(span).toBeTruthy();
    expect(talkText(span!)).toBe('“现在不怕了？”');
  });
});
