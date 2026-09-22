import { describe, expect, it } from 'vitest';
import { countWords, estimateTokens, truncateToTokenBudget } from './token';

describe('countWords', () => {
  it('汉字逐字计数', () => {
    expect(countWords('山海食肆录')).toBe(5);
  });

  it('连续的拉丁字母与数字算作一个词', () => {
    expect(countWords('hello world')).toBe(2);
    expect(countWords('chapter 12')).toBe(2);
  });

  it('中英混排分别计数', () => {
    // 他说 计二，OK 计一，然后走了 计四
    expect(countWords('他说 OK 然后走了')).toBe(7);
  });

  it('标点与空白不计数', () => {
    expect(countWords('。，、！？ \n\t')).toBe(0);
    expect(countWords('他说：「走吧。」')).toBe(4);
  });

  it('空字符串返回零', () => {
    expect(countWords('')).toBe(0);
  });
});

describe('estimateTokens', () => {
  it('中文按每字零点六八估算', () => {
    const tokens = estimateTokens('测试中文');
    expect(tokens).toBe(Math.ceil(4 * 0.68));
  });

  it('英文按每四个字符一个 token 估算', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcdefgh')).toBe(2);
  });

  it('空文本返回零', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('长文本的估算值随长度单调增长', () => {
    const short = estimateTokens('这是一段短文。');
    const long = estimateTokens('这是一段短文。'.repeat(20));
    expect(long).toBeGreaterThan(short);
  });
});

describe('truncateToTokenBudget', () => {
  it('未超预算时原样返回', () => {
    const text = '一段不需要裁剪的文本。';
    expect(truncateToTokenBudget(text, 1000)).toBe(text);
  });

  it('超预算时保留首尾并插入省略标记', () => {
    const text = '第一段内容。'.repeat(200);
    const result = truncateToTokenBudget(text, 60);
    expect(result).toContain('中略');
    expect(result.startsWith('第一段内容')).toBe(true);
    expect(estimateTokens(result)).toBeLessThanOrEqual(70);
  });

  it('预算为零时返回空字符串', () => {
    expect(truncateToTokenBudget('任意文本', 0)).toBe('');
  });
});
