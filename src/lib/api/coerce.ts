/**
 * 请求字段的取值与校验工具。
 *
 * 这些函数不依赖任何运行时框架，因此可以单独测试。
 * 所有函数在字段缺失时返回 undefined，交由调用方决定是否跳过该字段，
 * 这样局部更新接口才能做到「不传即不改」。
 */

/** 取字符串，缺失时返回 undefined；显式 null 返回空字符串。 */
export function asString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

/** 取必填字符串，缺失或空串时抛错。 */
export function asRequiredString(value: unknown, label: string): string {
  const result = asString(value);
  if (result === undefined || result.trim() === '') {
    throw new Error(`${label}不能为空`);
  }
  return result.trim();
}

/** 取数字，非法时返回 undefined。 */
export function asNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** 取整数，并限制在给定区间内。 */
export function asInt(value: unknown, min?: number, max?: number): number | undefined {
  const parsed = asNumber(value);
  if (parsed === undefined) return undefined;
  const rounded = Math.round(parsed);
  if (min !== undefined && rounded < min) return min;
  if (max !== undefined && rounded > max) return max;
  return rounded;
}

/** 取布尔值，兼容 0、1、true、false 等写法。 */
export function asBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
  }
  return undefined;
}

/** 取字符串数组，逗号、顿号或换行分隔的字符串也会被拆分。 */
export function asStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter((item) => item.length > 0);
  }
  if (typeof value === 'string') {
    return value
      .split(/[\n,，、]+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return undefined;
}

/** 取枚举值，非法时回落到默认值。 */
export function asEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback?: T,
): T | undefined {
  const text = asString(value) as T | undefined;
  if (text === undefined) return fallback;
  return allowed.includes(text) ? text : fallback;
}

/** 只保留补丁对象中显式出现的字段，避免用 undefined 覆盖既有值。 */
export function compact<T extends Record<string, unknown>>(input: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}
