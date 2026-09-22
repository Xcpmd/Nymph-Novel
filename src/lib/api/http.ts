import { NextResponse } from 'next/server';
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

/**
 * 接口的通用响应与请求读取工具。
 * 字段取值函数在 coerce.ts 中实现并在此转发，保持调用方只依赖一个模块。
 */

export {
  asBool,
  asEnum,
  asInt,
  asNumber,
  asRequiredString,
  asString,
  asStringArray,
  compact,
};

export interface ApiError {
  error: string;
  detail?: string;
}

/** 返回 JSON 成功响应。 */
export function json<T>(data: T, init?: ResponseInit): NextResponse<T> {
  return NextResponse.json(data, init);
}

/** 返回 JSON 错误响应。 */
export function fail(message: string, status = 400, detail?: string): NextResponse<ApiError> {
  return NextResponse.json({ error: message, detail }, { status });
}

/**
 * 包裹路由处理逻辑，把抛出的异常转成结构化错误。
 * 业务校验错误返回 400，其余返回 500，避免把堆栈直接暴露给界面。
 */
export async function handle<T>(
  fn: () => Promise<T> | T,
): Promise<NextResponse<T> | NextResponse<ApiError>> {
  try {
    const result = await fn();
    // 处理函数可以直接返回一个已构造好的响应，例如导出接口的文件流
    if (result instanceof Response) return result as unknown as NextResponse<T>;
    return NextResponse.json(result as T);
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    if (process.env.NODE_ENV !== 'production') {
      console.error('[nymph] 接口错误：', error);
    }
    const isValidation =
      /不存在|不能为空|不允许|非法|越界|格式/.test(message) || error instanceof SyntaxError;
    return fail(message, isValidation ? 400 : 500);
  }
}

/** 读取并解析请求体。空体返回空对象。 */
export async function readBody<T = Record<string, unknown>>(request: Request): Promise<T> {
  const text = await request.text();
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SyntaxError('请求体不是合法的 JSON 格式');
  }
}

/** 从查询参数中读取数字。 */
export function queryInt(url: URL, key: string): number | undefined {
  return asInt(url.searchParams.get(key));
}

/** 从查询参数中读取字符串。 */
export function queryString(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key);
  return value === null ? undefined : value;
}

/** 从查询参数中读取布尔值。 */
export function queryBool(url: URL, key: string): boolean | undefined {
  return asBool(url.searchParams.get(key));
}
