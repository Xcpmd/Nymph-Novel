import { describe, expect, it } from 'vitest';
import { parseStreamLine } from './client';

/**
 * 这一组用例来自一次真实故障。
 *
 * deepseek-flash 之类的推理模型会把思考过程写在 reasoning_content 里，
 * 而 content 保持 null。原先的实现只读 content，
 * 于是整条流被静默丢弃：界面显示「生成完成」，内容区一片空白，
 * 用户却已经为那部分 token 付了费。
 *
 * 帧结构照抄自实际抓取的响应，不是构造出来的理想数据。
 */
describe('parseStreamLine', () => {
  it('取出正文增量', () => {
    const line =
      'data: {"choices":[{"index":0,"delta":{"content":"她推开窗","reasoning_content":null},"finish_reason":null}]}';
    const parsed = parseStreamLine(line);
    expect(parsed?.content).toBe('她推开窗');
    expect(parsed?.reasoning).toBe('');
  });

  it('正文为空时仍然取到推理增量', () => {
    const line =
      'data: {"choices":[{"index":0,"delta":{"content":null,"reasoning_content":"我们需要"},"finish_reason":null}]}';
    const parsed = parseStreamLine(line);
    expect(parsed?.content).toBe('');
    expect(parsed?.reasoning).toBe('我们需要');
  });

  it('首帧 role 与两个字段都为空时不产出内容', () => {
    const line =
      'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":null,"reasoning_content":""},"finish_reason":null}]}';
    const parsed = parseStreamLine(line);
    expect(parsed).not.toBeNull();
    expect(parsed?.content).toBe('');
    expect(parsed?.reasoning).toBe('');
  });

  it('捕获 length 结束原因与用量', () => {
    // 尾帧的实际形态：额度被思考耗尽，正文为空，被硬截断
    const line =
      'data: {"choices":[{"index":0,"delta":{"content":"","reasoning_content":null},"finish_reason":"length"}],"usage":{"prompt_tokens":34,"completion_tokens":64,"total_tokens":98,"completion_tokens_details":{"reasoning_tokens":64}}}';
    const parsed = parseStreamLine(line);
    expect(parsed?.finishReason).toBe('length');
    expect(parsed?.usage).toEqual({
      promptTokens: 34,
      completionTokens: 64,
      totalTokens: 98,
      estimated: false,
    });
  });

  it('忽略结束标记与空行', () => {
    expect(parseStreamLine('data: [DONE]')).toBeNull();
    expect(parseStreamLine('')).toBeNull();
    expect(parseStreamLine('   ')).toBeNull();
  });

  it('忽略非 data 前缀的心跳行', () => {
    expect(parseStreamLine(': keep-alive')).toBeNull();
    expect(parseStreamLine('event: ping')).toBeNull();
  });

  it('非 JSON 的 data 行不抛异常', () => {
    expect(parseStreamLine('data: 这不是 JSON')).toBeNull();
  });

  it('缺少 usage 时不编造用量', () => {
    const parsed = parseStreamLine(
      'data: {"choices":[{"index":0,"delta":{"content":"a"},"finish_reason":null}]}',
    );
    expect(parsed?.usage).toBeUndefined();
  });
});
