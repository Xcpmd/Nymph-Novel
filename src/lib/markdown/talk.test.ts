import { describe, expect, it } from 'vitest';
import {
  collectSpeakers,
  hueForSpeaker,
  parseMarkedTalk,
  splitTalkSegments,
  stripTalkMarkers,
  stripWalkMarkers,
  talkToMarkedText,
  talkToPlainText,
} from './talk';

/**
 * 角色发言标记的解析测试。
 *
 * 标记语法由生成提示词约定，前端负责把它渲染成带双引号、按角色着色的对白，
 * 导出与统计时则要还原成普通文本，因此这三条路径都需要覆盖。
 */

describe('splitTalkSegments', () => {
  it('把叙述与发言拆成交替片段', () => {
    const input = '他推开门。<talk chara="阿禾">你回来了</talk>屋里没有点灯。';
    const segments = splitTalkSegments(input);

    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ talk: false, chara: '', text: '他推开门。' });
    expect(segments[1]).toEqual({ talk: true, chara: '阿禾', text: '你回来了' });
    expect(segments[2]).toEqual({ talk: false, chara: '', text: '屋里没有点灯。' });
  });

  it('没有标记时整体作为叙述返回', () => {
    const segments = splitTalkSegments('只有叙述，没有对白。');
    expect(segments).toHaveLength(1);
    expect(segments[0]!.talk).toBe(false);
  });

  it('连续两段发言都能被识别', () => {
    const input = '<talk chara="甲">先走</talk><talk chara="乙">等一下</talk>';
    const segments = splitTalkSegments(input);
    expect(segments.map((segment) => segment.chara)).toEqual(['甲', '乙']);
  });
});

describe('collectSpeakers', () => {
  it('按首次出现顺序去重收集角色名', () => {
    const input = [
      '<talk chara="阿禾">一</talk>',
      '叙述',
      '<talk chara="老张">二</talk>',
      '<talk chara="阿禾">三</talk>',
    ].join('');
    expect(collectSpeakers(input)).toEqual(['阿禾', '老张']);
  });

  it('忽略空角色名', () => {
    expect(collectSpeakers('<talk chara="">无主</talk>')).toEqual([]);
  });
});

describe('talkToPlainText', () => {
  it('把标记还原为中文双引号对白', () => {
    const input = '他说：<talk chara="阿禾">别回头</talk>';
    expect(talkToPlainText(input)).toBe('他说：“别回头”');
  });

  it('空发言内容被整段移除', () => {
    expect(talkToPlainText('前<talk chara="甲">   </talk>后')).toBe('前后');
  });
});

describe('talkToMarkedText 与 parseMarkedTalk', () => {
  it('转换后仍然可以解析回角色名与内容', () => {
    const marked = talkToMarkedText('<talk chara="阿禾">你回来了</talk>');
    const parsed = parseMarkedTalk(marked);

    expect(parsed).toEqual({ chara: '阿禾', text: '你回来了' });
  });

  it('非标记文本解析返回空', () => {
    expect(parseMarkedTalk('普通文本')).toBeNull();
  });

  it('发言中的换行会被压成空格，保持行内渲染', () => {
    const marked = talkToMarkedText('<talk chara="甲">第一句\n第二句</talk>');
    const parsed = parseMarkedTalk(marked);
    expect(parsed?.text).toBe('第一句 第二句');
  });
});

describe('stripTalkMarkers', () => {
  it('剥离标记但保留发言内容', () => {
    const input = '他喊：<talk chara="阿禾">快跑</talk>然后就消失在雨里。';
    expect(stripTalkMarkers(input)).toBe('他喊：快跑然后就消失在雨里。');
  });
});

describe('stripWalkMarkers', () => {
  it('清除步骤区块、步骤状态、查询与调阅标记', () => {
    const input = [
      '<step time="次日">主角进城</step>',
      '正文内容。',
      '<step-status value="done">已完成第一步</step-status>',
      '<query>灵石的价格</query>',
      '<recall event="拍卖会">需要回顾细节</recall>',
    ].join('\n');

    const cleaned = stripWalkMarkers(input);
    expect(cleaned).toBe('正文内容。');
  });

  it('无标记的正文原样返回', () => {
    expect(stripWalkMarkers('干净正文')).toBe('干净正文');
  });

  it('把连续空行压成单个空行', () => {
    const input = '第一段\n\n\n\n第二段';
    expect(stripWalkMarkers(input)).toBe('第一段\n\n第二段');
  });
});

describe('hueForSpeaker', () => {
  it('同一角色名始终得到同一色相', () => {
    expect(hueForSpeaker('阿禾')).toBe(hueForSpeaker('阿禾'));
  });

  it('色相落在 0 到 359 之间', () => {
    for (const name of ['甲', '乙', '丙', '很长的一个角色名字', 'A']) {
      const hue = hueForSpeaker(name);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });
});
