import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownView } from './MarkdownView';

/**
 * 正文渲染的端到端测试。
 *
 * 直接渲染组件并检查最终 HTML，覆盖「标记文本 → rehype 转换 → 清洗 → React 元素」
 * 这条完整链路。此前的缺陷正是出在这条链路上：标记没有变成元素，
 * 页面上既不显示双引号也不上色，而纯函数的单元测试全绿。
 */

/** 渲染一段正文，返回静态 HTML。 */
function render(content: string, options: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(createElement(MarkdownView, { content, ...options }));
}

describe('正文里的角色发言渲染', () => {
  const SPEECH = '他推开门。<talk chara="陨星">现在不怕了？</talk>屋里没有点灯。';

  it('发言渲染成带类名与角色名的元素', () => {
    const html = render(SPEECH);
    expect(html).toContain('class="talk-line"');
    expect(html).toContain('data-chara="陨星"');
  });

  it('发言自动补上中文双引号', () => {
    const html = render(SPEECH);
    expect(html).toContain('“现在不怕了？”');
  });

  it('标记本身不会出现在页面上', () => {
    const html = render(SPEECH);
    expect(html).not.toContain('<talk');
    expect(html).not.toContain('</talk>');
  });

  it('私有区定界字符不会泄漏到页面上', () => {
    const html = render(SPEECH);
    expect(html).not.toMatch(/[\uE000-\uE002]/u);
  });

  it('前后叙述都保留', () => {
    const html = render(SPEECH);
    expect(html).toContain('他推开门。');
    expect(html).toContain('屋里没有点灯。');
  });

  it('按角色图鉴设定的色相染色', () => {
    // 色相来自角色图鉴，而不是按名称推导的兜底值
    const html = render(SPEECH, { speakers: { 陨星: 210 } });
    expect(html).toContain('--talk-hue:210');
  });

  it('未登记的角色回落到名称推导的稳定色相', () => {
    const withMap = render(SPEECH, { speakers: { 陨星: 210 } });
    const withoutMap = render(SPEECH);
    expect(withoutMap).toContain('--talk-hue:');
    expect(withoutMap).not.toBe(withMap);
    // 同一内容重复渲染颜色一致
    expect(render(SPEECH)).toBe(withoutMap);
  });

  it('多个角色各自染色', () => {
    const html = render('<talk chara="甲">先走</talk><talk chara="乙">等一下</talk>', {
      speakers: { 甲: 10, 乙: 200 },
    });
    expect(html).toContain('--talk-hue:10');
    expect(html).toContain('--talk-hue:200');
  });

  it('角色名可以整体隐藏', () => {
    const shown = render(SPEECH, { showSpeakerName: true });
    const hidden = render(SPEECH, { showSpeakerName: false });
    expect(shown).not.toContain('talk-names-hidden');
    expect(hidden).toContain('talk-names-hidden');
    // 隐藏时对白本身仍在
    expect(hidden).toContain('“现在不怕了？”');
  });

  it('关闭标记解析后按普通文本渲染', () => {
    const html = render('<talk chara="陨星">现在不怕了？</talk>', { talkEnabled: false });
    expect(html).not.toContain('talk-line');
    expect(html).not.toContain('“现在不怕了？”');
  });

  it('正文里的原始 HTML 不会被当作标签执行', () => {
    const html = render('正常段落。<script>alert(1)</script>');
    expect(html).not.toContain('<script');
    expect(html).toContain('正常段落。');
  });

  it('代码块里的尖括号标记保持原样不染色', () => {
    const html = render('```\n<talk chara="甲">示例</talk>\n```');
    expect(html).not.toContain('class="talk-line"');
    expect(html).toContain('示例');
  });

  it('没有标记的正文照常渲染', () => {
    const html = render('只有叙述，没有对白。');
    expect(html).toContain('只有叙述，没有对白。');
    expect(html).not.toContain('talk-line');
  });

  it('空正文给出占位提示', () => {
    expect(render('   ')).toContain('正文尚未填写');
  });
});
