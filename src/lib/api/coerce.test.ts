import { describe, expect, it } from 'vitest';
import {
  asBool,
  asEnum,
  asInt,
  asNumber,
  asRequiredString,
  asString,
  asStringArray,
  compact,
} from './coerce';

describe('asString', () => {
  it('字符串原样返回', () => {
    expect(asString('文本')).toBe('文本');
  });

  it('数字与布尔转为字符串', () => {
    expect(asString(12)).toBe('12');
    expect(asString(false)).toBe('false');
  });

  it('缺失返回 undefined，显式 null 返回空串', () => {
    expect(asString(undefined)).toBeUndefined();
    expect(asString(null)).toBe('');
  });

  it('对象与数组不被接受', () => {
    expect(asString({ a: 1 })).toBeUndefined();
    expect(asString([1, 2])).toBeUndefined();
  });
});

describe('asRequiredString', () => {
  it('去除首尾空格后返回', () => {
    expect(asRequiredString('  甲  ', '标题')).toBe('甲');
  });

  it('缺失或空白时抛错并带上字段名', () => {
    expect(() => asRequiredString('', '章节标题')).toThrow('章节标题不能为空');
    expect(() => asRequiredString(undefined, '章节标题')).toThrow();
    expect(() => asRequiredString('   ', '章节标题')).toThrow();
  });
});

describe('asNumber 与 asInt', () => {
  it('解析数字字符串', () => {
    expect(asNumber('12.5')).toBe(12.5);
  });

  it('非数字返回 undefined', () => {
    expect(asNumber('abc')).toBeUndefined();
    expect(asNumber(NaN)).toBeUndefined();
    expect(asNumber('')).toBeUndefined();
  });

  it('asInt 四舍五入并收敛到区间内', () => {
    expect(asInt('3.6')).toBe(4);
    expect(asInt(0, 1, 5)).toBe(1);
    expect(asInt(99, 1, 5)).toBe(5);
    expect(asInt(undefined, 1, 5)).toBeUndefined();
  });
});

describe('asBool', () => {
  it('识别常见真值写法', () => {
    for (const value of ['true', '1', 'yes', 'on', 1, true]) {
      expect(asBool(value)).toBe(true);
    }
  });

  it('识别常见假值写法', () => {
    for (const value of ['false', '0', 'no', 'off', '', 0, false]) {
      expect(asBool(value)).toBe(false);
    }
  });

  it('无法识别时返回 undefined', () => {
    expect(asBool('也许')).toBeUndefined();
    expect(asBool(undefined)).toBeUndefined();
  });
});

describe('asStringArray', () => {
  it('数组去除空白项', () => {
    expect(asStringArray(['甲', ' ', '乙'])).toEqual(['甲', '乙']);
  });

  it('字符串按中英文逗号、顿号与换行拆分', () => {
    expect(asStringArray('甲，乙,丙、丁\n戊')).toEqual(['甲', '乙', '丙', '丁', '戊']);
  });

  it('缺失返回 undefined', () => {
    expect(asStringArray(undefined)).toBeUndefined();
  });
});

describe('asEnum', () => {
  const allowed = ['a', 'b'] as const;

  it('合法值直接返回', () => {
    expect(asEnum('a', allowed)).toBe('a');
  });

  it('非法值回落到默认值', () => {
    expect(asEnum('c', allowed, 'b')).toBe('b');
    expect(asEnum('c', allowed)).toBeUndefined();
  });

  it('缺失时返回默认值', () => {
    expect(asEnum(undefined, allowed, 'a')).toBe('a');
  });
});

describe('compact', () => {
  it('剔除值为 undefined 的字段', () => {
    expect(compact({ a: 1, b: undefined, c: '' })).toEqual({ a: 1, c: '' });
  });

  it('保留显式的 null 与零', () => {
    expect(compact({ a: null, b: 0, c: false })).toEqual({ a: null, b: 0, c: false });
  });
});
