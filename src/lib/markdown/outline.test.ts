import { describe, expect, it } from 'vitest';
import { deriveEventTitle, deriveStepsFromOutline } from './outline';

/**
 * 手写大纲的步骤推导。
 *
 * 手写内容不像 AI 输出那样带步骤标记，推导结果直接决定事件能否逐章推进，
 * 因此把各种常见的书写形态都固定成用例。
 */

describe('从手写大纲推导步骤', () => {
  it('优先采用有序列表', () => {
    const outline = `# 雨夜的相遇

1. 主角在茶棚躲雨，遇见卖伞的老人。
2. 老人送出一把旧伞，伞骨上刻着陌生的字。
3. 主角撑伞离开，发现雨停在伞面之外。

补充说明这一段不属于任何步骤。`;
    const steps = deriveStepsFromOutline(outline);
    expect(steps.length).toBe(3);
    expect(steps[0]!.title).toContain('茶棚躲雨');
    expect(steps[2]!.title).toContain('撑伞离开');
  });

  it('兼容顿号与右括号的编号写法', () => {
    const steps = deriveStepsFromOutline('1、第一步要做的事。\n2）第二步要做的事。');
    expect(steps.length).toBe(2);
  });

  it('有序列表没有时采用无序列表', () => {
    const steps = deriveStepsFromOutline('- 先抵达渡口。\n- 再登上渡船。\n- 最后抵达对岸。');
    expect(steps.length).toBe(3);
  });

  it('没有列表时采用小节标题', () => {
    const outline = `事件名

## 起因
主角收到一封没有署名的信。

## 经过
主角循着信里的线索找到旧宅。

## 收束
主角在旧宅里见到写信的人。`;
    const steps = deriveStepsFromOutline(outline);
    expect(steps.length).toBe(3);
    expect(steps[0]!.title).toBe('起因');
  });

  it('没有列表与标题时按自然段切分，首段作为事件名不单独成步', () => {
    const outline = `雨夜的相遇

主角在茶棚躲雨，遇见一位卖伞的老人。

老人送出一把旧伞，伞骨上刻着陌生的字。`;
    const steps = deriveStepsFromOutline(outline);
    expect(steps.length).toBe(2);
    expect(steps[0]!.title).toContain('茶棚躲雨');
  });

  it('单条列表不视为列表结构', () => {
    // 只有一条时更像普通段落，应回落到段落切分
    const steps = deriveStepsFromOutline('1. 只有一句话的说明。');
    expect(steps.length).toBe(1);
  });

  it('把列表项之后的缩进内容收作步骤说明', () => {
    const outline = `1. 主角进入旧宅。
   旧宅的走廊里挂着褪色的照片。
2. 主角找到日记。`;
    const steps = deriveStepsFromOutline(outline);
    expect(steps[0]!.detail).toContain('褪色的照片');
  });

  it('过长的提要会被截断', () => {
    const long = '这是一段很长的说明'.repeat(12);
    const steps = deriveStepsFromOutline(`${long}\n\n第二段内容。`);
    expect(steps[0]!.title.length).toBeLessThanOrEqual(61);
  });

  it('步骤数量有上限', () => {
    const outline = Array.from({ length: 60 }, (_, index) => `${index + 1}. 第${index + 1}步。`).join('\n');
    expect(deriveStepsFromOutline(outline).length).toBeLessThanOrEqual(24);
  });

  it('空白内容推导为空数组', () => {
    expect(deriveStepsFromOutline('')).toEqual([]);
    expect(deriveStepsFromOutline('   \n  \n')).toEqual([]);
  });
});

describe('从手写大纲推断事件标题', () => {
  it('优先取一级标题', () => {
    expect(deriveEventTitle('# 雨夜的相遇\n\n正文内容。')).toBe('雨夜的相遇');
  });

  it('没有标题时取首个非空行', () => {
    expect(deriveEventTitle('\n\n雨夜的相遇\n正文内容。')).toBe('雨夜的相遇');
  });

  it('内容为空时回落到兜底名称', () => {
    expect(deriveEventTitle('   ')).toBe('手写事件');
    expect(deriveEventTitle('', '未命名事件')).toBe('未命名事件');
  });

  it('过长的标题会被截断', () => {
    const title = deriveEventTitle('这是一个非常长的事件标题'.repeat(5));
    expect(title.length).toBeLessThanOrEqual(41);
  });
});
