import { zh, type Dictionary } from './zh';

/**
 * 语言注册表。
 *
 * 需求要求：页面仅提供中文，全部翻译集中在 zh.ts。
 * 需要其他语言时，复制 zh.ts 为同目录下的目标语言文件，
 * 在下面 import 后登记到 DICTIONARIES，即可在设置页直接启用。
 *
 * 示例：
 *   import { en } from './en';
 *   export const DICTIONARIES = { zh, en };
 */

export const DICTIONARIES: Record<string, Dictionary> = {
  zh,
};

export const LOCALES: Array<{ code: string; label: string }> = [
  { code: 'zh', label: '简体中文' },
];

export const DEFAULT_LOCALE = 'zh';

function lookup(dictionary: Dictionary, path: string): string | undefined {
  const segments = path.split('.');
  let current: unknown = dictionary;
  for (const segment of segments) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === 'string' ? current : undefined;
}

/** 把 {{name}} 形式的占位符替换为实际值。 */
export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const value = params[key];
    return value === undefined ? '' : String(value);
  });
}

/**
 * 取得翻译文本。
 * 找不到对应文案时回退到默认语言，再回退到键名本身，避免界面出现空白。
 */
export function translate(
  locale: string,
  path: string,
  params?: Record<string, string | number>,
): string {
  const dictionary = DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE]!;
  const value = lookup(dictionary, path) ?? lookup(DICTIONARIES[DEFAULT_LOCALE]!, path) ?? path;
  return interpolate(value, params);
}

/** 生成绑定到某个语言的翻译函数，供组件内使用。 */
export function createTranslator(locale: string) {
  return (path: string, params?: Record<string, string | number>) => translate(locale, path, params);
}

export type Translator = ReturnType<typeof createTranslator>;

export { zh };
export type { Dictionary };
