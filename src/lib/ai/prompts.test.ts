import { describe, expect, it } from 'vitest';
import {
  parseModelDirectives,
  parseStepBlocks,
  parseStepStatus,
  stripStepBlocks,
} from './prompts';

/**
 * 生成流程控制标记的解析测试。
 *
 * 大纲步骤、设定查询与事件调阅都通过标记嵌入模型输出，
 * 这些标记只服务于流程控制，绝不能泄漏到正文里，因此解析与剥离都要覆盖。
 */

describe('parseModelDirectives', () => {
  it('解析查询标记并去重', () => {
    const input = '正文。<query>灵石价格</query>中段<query>灵石价格</query><query>九州的划分</query>';
    const result = parseModelDirectives(input);

    expect(result.queries).toEqual(['灵石价格', '九州的划分']);
    expect(result.clean).toBe('正文。中段');
  });

  it('解析事件调阅请求', () => {
    const input = '正文。<recall event="拍卖会">需要回顾出场的法器</recall>';
    const result = parseModelDirectives(input);

    expect(result.recalls).toEqual([{ event: '拍卖会', reason: '需要回顾出场的法器' }]);
    expect(result.clean).toBe('正文。');
  });

  it('同时处理查询与调阅，并返回干净正文', () => {
    const input = [
      '<query>江湖门派</query>',
      '他走进客栈。',
      '<recall event="三年前的旧案">确认细节</recall>',
      '<query>客栈名字</query>',
    ].join('\n');
    const result = parseModelDirectives(input);

    expect(result.queries).toEqual(['江湖门派', '客栈名字']);
    expect(result.recalls).toHaveLength(1);
    expect(result.clean).toBe('他走进客栈。');
  });

  it('忽略空的查询标记', () => {
    expect(parseModelDirectives('<query>   </query>正文').queries).toEqual([]);
  });

  it('没有标记时原样返回', () => {
    const result = parseModelDirectives('  纯正文  ');
    expect(result.queries).toEqual([]);
    expect(result.recalls).toEqual([]);
    expect(result.clean).toBe('纯正文');
  });
});

describe('parseStepBlocks', () => {
  it('按顺序解析带时间的步骤', () => {
    const input = [
      '<step time="第三日清晨">主角抵达渡口</step>',
      '<step time="同日午后">与船家发生争执</step>',
    ].join('\n');
    const steps = parseStepBlocks(input);

    expect(steps).toEqual([
      { time: '第三日清晨', title: '主角抵达渡口' },
      { time: '同日午后', title: '与船家发生争执' },
    ]);
  });

  it('缺少时间属性时时间留空', () => {
    expect(parseStepBlocks('<step>无时间步骤</step>')).toEqual([
      { time: '', title: '无时间步骤' },
    ]);
  });

  it('跳过内容为空的步骤', () => {
    expect(parseStepBlocks('<step time="某日">  </step>')).toEqual([]);
  });
});

describe('stripStepBlocks', () => {
  it('移除步骤区块但保留正文', () => {
    const input = '<step time="次日">主角启程</step>\n\n真正的正文。';
    expect(stripStepBlocks(input)).toBe('真正的正文。');
  });

  it('压缩多余空行', () => {
    expect(stripStepBlocks('第一段\n\n\n\n第二段')).toBe('第一段\n\n第二段');
  });
});

describe('parseStepStatus', () => {
  it('识别 done 标记并返回说明', () => {
    const result = parseStepStatus('正文<step-status value="done">本步已完成</step-status>');
    expect(result).toEqual({ value: 'done', remainder: '本步已完成' });
  });

  it('识别 partial 标记', () => {
    const result = parseStepStatus('正文<step-status value="partial">本步未完</step-status>');
    expect(result).toEqual({ value: 'partial', remainder: '本步未完' });
  });

  it('没有标记时默认视为已完成', () => {
    expect(parseStepStatus('纯正文')).toEqual({ value: 'done', remainder: '' });
  });
});
