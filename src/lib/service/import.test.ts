import { describe, expect, it } from 'vitest';
import { parsePlainText } from './import';

describe('纯文本导入解析', () => {
  it('按第X章标记切分章节', () => {
    const text = [
      '第一章 落雨的渡口',
      '雨下了一整夜。',
      '',
      '第二章 旧灯笼',
      '茶棚的灯笼褪成了灰白色。',
    ].join('\n');
    const chapters = parsePlainText(text);
    expect(chapters.length).toBe(2);
    expect(chapters[0]!.title).toBe('第一章 落雨的渡口');
    expect(chapters[0]!.content).toContain('雨下了一整夜。');
    expect(chapters[1]!.title).toBe('第二章 旧灯笼');
  });

  it('识别卷标记并把后续章节归入该卷', () => {
    const text = [
      '第一卷 风起',
      '第一章 开端',
      '正文甲。',
      '第二卷 落潮',
      '第一章 重逢',
      '正文乙。',
    ].join('\n');
    const chapters = parsePlainText(text);
    expect(chapters.length).toBe(2);
    expect(chapters[0]!.volumeTitle).toBe('第一卷 风起');
    expect(chapters[1]!.volumeTitle).toBe('第二卷 落潮');
  });

  it('支持回目形式的章节标记', () => {
    const chapters = parsePlainText('第一回 山中来客\n有人叩门。\n第三回 夜半刀声\n刀光一闪。');
    expect(chapters.length).toBe(2);
    expect(chapters[0]!.title).toBe('第一回 山中来客');
  });

  it('没有章节标记时整体作为一章导入', () => {
    const chapters = parsePlainText('这段文字没有任何章节标记，应当整体成为一章。');
    expect(chapters.length).toBe(1);
    expect(chapters[0]!.content).toContain('没有任何章节标记');
  });

  it('空文本返回空数组', () => {
    expect(parsePlainText('')).toEqual([]);
    expect(parsePlainText('   \n\n  ')).toEqual([]);
  });

  it('章标题后为空时只保留标记本身', () => {
    const chapters = parsePlainText('第七章\n正文内容。');
    expect(chapters[0]!.title).toBe('第七章');
    expect(chapters[0]!.content).toBe('正文内容。');
  });
});
