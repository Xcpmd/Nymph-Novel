import { describe, expect, it } from 'vitest';
import { isNovelTextKey, NOVEL_TEXT_KEYS } from '../repo/settings';
import { SETUP_FILES } from '../store/setup-files';

/**
 * 小说文本配置键的契约。
 *
 * 这些键同时作为库中字段名与接口请求体字段名使用，
 * 若两处写法不一致，写入会被静默跳过，界面表现为「保存后刷新就没了」。
 */

/** 设定页实际提交的字段名，必须与 NOVEL_TEXT_KEYS 完全一致。 */
const CLIENT_TEXT_FIELDS = ['worldview', 'setting', 'outlineOverview', 'endingPlan', 'styleSample'];

describe('小说文本配置键', () => {
  it('全部使用驼峰写法，不使用下划线', () => {
    for (const key of Object.values(NOVEL_TEXT_KEYS)) {
      expect(key, `键 ${key} 不应包含下划线`).not.toContain('_');
    }
  });

  it('与设定页提交的字段名逐一对齐', () => {
    expect(Object.values(NOVEL_TEXT_KEYS).slice().sort()).toEqual(CLIENT_TEXT_FIELDS.slice().sort());
  });

  it('字段名与常量名保持一致，避免读写错位', () => {
    for (const [name, value] of Object.entries(NOVEL_TEXT_KEYS)) {
      expect(value, `常量名 ${name} 与其值 ${value} 不一致`).toBe(name);
    }
  });

  it('每一项都有对应的设定文件', () => {
    for (const key of Object.values(NOVEL_TEXT_KEYS)) {
      expect(Object.keys(SETUP_FILES), `缺少 ${key} 对应文件`).toContain(key);
    }
  });

  it('历史下划线写法仍被识别为文本键', () => {
    // 存量数据与缓存了旧代码的进程都可能产出这些键，读写两侧都必须能认出
    expect(isNovelTextKey('outline_overview')).toBe(true);
    expect(isNovelTextKey('ending_plan')).toBe(true);
    expect(isNovelTextKey('style_sample')).toBe(true);
  });

  it('当前驼峰写法被识别为文本键', () => {
    for (const key of Object.values(NOVEL_TEXT_KEYS)) {
      expect(isNovelTextKey(key), `${key} 应被识别为文本键`).toBe(true);
    }
  });

  it('普通配置键不会被误判为文本键', () => {
    // 这条是保存失效那个缺陷的防线：preferences 里混入文本键的空值，
    // 前端展开后会把用户真实内容覆盖成空串
    for (const key of ['rules', 'budget', 'calendar', 'targetWords', 'autoAdvanceEvent']) {
      expect(isNovelTextKey(key), `${key} 不应被当成文本键`).toBe(false);
    }
  });
});
