import { describe, expect, it } from 'vitest';
import {
  BUILTIN_PROMPTS,
  TASK_LABELS,
  extractPlaceholders,
  extractRecordList,
  getBuiltinPrompt,
  normalizeOptionList,
  renderTemplate,
} from './prompts';
import { extractJson } from './client';
import { findPreset, PROVIDER_PRESETS } from './presets';

describe('提示词模板', () => {
  it('每个任务类型都有模板与中文标签', () => {
    for (const prompt of BUILTIN_PROMPTS) {
      expect(prompt.systemPrompt.length).toBeGreaterThan(0);
      expect(prompt.userPrompt.length).toBeGreaterThan(0);
      expect(TASK_LABELS[prompt.taskType]).toBe(prompt.label);
    }
  });

  it('未知任务回落到自由对话模板', () => {
    // 类型上不会出现，这里模拟脏数据
    const fallback = getBuiltinPrompt('unknown-task' as never);
    expect(fallback.taskType).toBe('free');
  });

  it('模板文本不使用括号做补充解释', () => {
    for (const prompt of BUILTIN_PROMPTS) {
      const withoutCodeBlocks = `${prompt.systemPrompt}\n${prompt.userPrompt}`.replace(
        /```[\s\S]*?```/g,
        '',
      );
      expect(withoutCodeBlocks).not.toMatch(/（[^）]*(例如|即|也就是)[^）]*）/);
    }
  });
});

describe('renderTemplate', () => {
  it('替换已知变量', () => {
    const result = renderTemplate('小说：{{novelTitle}}，目标 {{targetWords}} 字', {
      novelTitle: '山海食肆录',
      targetWords: '3000',
    });
    expect(result).toBe('小说：山海食肆录，目标 3000 字');
  });

  it('允许变量名两侧存在空格', () => {
    expect(renderTemplate('{{ novelTitle }}', { novelTitle: '甲' })).toBe('甲');
  });

  it('未提供的变量替换为空字符串，界面上不会出现裸露占位符', () => {
    expect(renderTemplate('前{{missing}}后', {})).toBe('前后');
  });

  it('未知格式的花括号保持原样', () => {
    expect(renderTemplate('{单括号}', {})).toBe('{单括号}');
  });
});

describe('extractPlaceholders', () => {
  it('去重并排序返回模板中的全部变量名', () => {
    const placeholders = extractPlaceholders('{{b}} {{a}} {{b}}');
    expect(placeholders).toEqual(['a', 'b']);
  });
});

describe('extractJson', () => {
  it('直接解析纯 JSON 文本', () => {
    expect(extractJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('剥离 Markdown 代码块后解析', () => {
    const raw = '```json\n[{"title":"方向一"}]\n```';
    expect(extractJson<Array<{ title: string }>>(raw)).toEqual([{ title: '方向一' }]);
  });

  it('忽略前后说明文字，截取数组片段', () => {
    const raw = '好的，以下是结果：[{"title":"甲"},{"title":"乙"}] 希望对你有帮助。';
    const parsed = extractJson<Array<{ title: string }>>(raw);
    expect(parsed?.length).toBe(2);
  });

  it('无法解析时返回 null', () => {
    expect(extractJson('这不是 JSON')).toBeNull();
  });
});

describe('方向选项归一化', () => {
  // 下面三种都是 DeepSeek 在 JSON 模式下的真实返回，逐条留作回归样例。
  // 前端原先只接受裸数组，导致方向卡片一条都显示不出来。
  const REAL_DEEPSEEK_OUTPUTS = [
    '{"directions":[{"title":"日常渗透","summary":"两人开始同居生活","tone":"轻松日常","risk":"节奏偏慢"}]}',
    '{"type":"json_object","directions":[{"title":"邪教伏击","summary":"邪教发起突袭","tone":"激烈冲突"}]}',
    '{"type":"json_object","content":{"directions":[{"title":"空间裂隙","summary":"裂隙打开","risk":"摊子铺得太大"}]}}',
  ];

  it('还原模型再包一层的数组', () => {
    for (const raw of REAL_DEEPSEEK_OUTPUTS) {
      const options = normalizeOptionList(extractJson<unknown>(raw));
      expect(options.length, `未能解析：${raw.slice(0, 40)}`).toBe(1);
      expect(options[0]!.title.length).toBeGreaterThan(0);
      expect(options[0]!.summary.length).toBeGreaterThan(0);
    }
  });

  it('裸数组原样通过', () => {
    const options = normalizeOptionList([{ title: '甲', summary: '说明甲' }]);
    expect(options).toEqual([{ title: '甲', summary: '说明甲', tone: undefined, risk: undefined }]);
  });

  it('保留基调与风险字段', () => {
    const options = normalizeOptionList([{ title: '甲', summary: '说明', tone: '紧张', risk: '拖沓' }]);
    expect(options[0]!.tone).toBe('紧张');
    expect(options[0]!.risk).toBe('拖沓');
  });

  it('字段名换成 name 与 description 也能读出来', () => {
    const options = normalizeOptionList({ options: [{ name: '乙', description: '说明乙' }] });
    expect(options[0]!.title).toBe('乙');
    expect(options[0]!.summary).toBe('说明乙');
  });

  it('未知包装时取对象里第一个数组值', () => {
    const options = normalizeOptionList({ payload: { whatever: [{ title: '丙', summary: '说明丙' }] } });
    expect(options[0]!.title).toBe('丙');
  });

  it('空结构与非对象返回空数组', () => {
    expect(normalizeOptionList(null)).toEqual([]);
    expect(normalizeOptionList('文本')).toEqual([]);
    expect(normalizeOptionList({})).toEqual([]);
    expect(normalizeOptionList({ directions: [] })).toEqual([]);
  });

  it('丢弃既无标题又无说明的空项', () => {
    const options = normalizeOptionList([{ title: '有效', summary: '说明' }, { foo: 'bar' }]);
    expect(options.length).toBe(1);
  });
});

describe('记录数组提取', () => {
  it('从包裹对象里取出条目数组', () => {
    const list = extractRecordList({ entries: [{ name: '甲' }] }, ['entries', 'items']);
    expect(list).toEqual([{ name: '甲' }]);
  });

  it('裸数组直接返回', () => {
    expect(extractRecordList([{ name: '乙' }], ['entries'])).toEqual([{ name: '乙' }]);
  });

  it('过滤掉数组里的非对象元素', () => {
    const list = extractRecordList([{ name: '甲' }, '文本', 42], ['entries']);
    expect(list).toEqual([{ name: '甲' }]);
  });

  it('没有数组时返回空数组', () => {
    expect(extractRecordList({ message: '没有抽取到新设定' }, ['entries'])).toEqual([]);
  });
});

describe('供应商预设', () => {
  it('预设项包含完整的接入信息', () => {
    for (const preset of PROVIDER_PRESETS) {
      expect(preset.name.length).toBeGreaterThan(0);
      if (preset.id === 'custom') continue;
      expect(preset.baseUrl.startsWith('http')).toBe(true);
      expect(preset.defaultModel.length).toBeGreaterThan(0);
      expect(preset.models).toContain(preset.defaultModel);
    }
  });

  it('按标识查找预设', () => {
    expect(findPreset('deepseek')?.name).toBe('DeepSeek');
    expect(findPreset('not-exist')).toBeNull();
    expect(findPreset(null)).toBeNull();
  });
});
