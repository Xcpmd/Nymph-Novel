import { getDb, now, parseJson } from '../db';
import { readSetupFile } from '../store/setup-files';
import type { ContextBudget, GenerationRules, NovelPreferences, ThemeMode } from '../types';

/** 全局应用配置。 */
export interface AppSettings {
  /** 主题色相，0 到 360，用于生成点缀色 */
  accentHue: number;
  /** 明暗主题模式 */
  themeMode: ThemeMode;
  /** 当前启用的语言代码，默认 zh */
  locale: string;
  /** 当前激活的供应商 id */
  activeProviderId: string | null;
  /** 默认上下文预算 */
  budget: ContextBudget;
  /** 界面密度 */
  density: 'comfortable' | 'compact';
  /** 阅读字号 */
  readerFontSize: number;
  /** 阅读区域最大宽度 */
  readerWidth: number;
  /** 是否在生成时显示思维流式输出 */
  showStreamingRaw: boolean;
  /** 阅读正文时是否在角色发言前显示角色名 */
  showSpeakerName: boolean;
}

export const DEFAULT_BUDGET: ContextBudget = {
  total: 72000,
  always: 20000,
  recalled: 20000,
  outlines: 26000,
  reserved: 6000,
};

export const DEFAULT_RULES: GenerationRules = {
  style: '叙事节奏稳健，画面感强，少用总结式叙述，多用具体行动与对话推动情节。',
  pov: '第三人称限知视角，跟随主角展开。',
  allowExplicit: false,
  allowViolence: true,
  forbidden: ['不使用括号补充说明', '不使用现代网络流行语', '不出现作者旁白式吐槽'],
  speechHabits: '每个角色的用词与句长应有区分度，主角说话简短直接。',
  extra: [],
};

export const DEFAULT_PREFERENCES: NovelPreferences = {
  targetWords: 3000,
  wordTolerancePercent: 15,
  calendar: '尚未设定历法，请在小说设置中填写，例如纪元名称、月份划分与纪年方式。',
  rules: DEFAULT_RULES,
  budget: DEFAULT_BUDGET,
  autoAdvanceEvent: true,
  autoExtractSettings: true,
  allowEventRecall: true,
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  accentHue: 265,
  themeMode: 'system',
  locale: 'zh',
  activeProviderId: null,
  budget: DEFAULT_BUDGET,
  density: 'comfortable',
  readerFontSize: 17,
  readerWidth: 46,
  showStreamingRaw: false,
  showSpeakerName: true,
};

function readSettingsMap(): Record<string, unknown> {
  const rows = getDb().prepare('SELECT key, value FROM app_settings').all() as Array<{
    key: string;
    value: string;
  }>;
  const map: Record<string, unknown> = {};
  for (const row of rows) {
    map[row.key] = parseJson<unknown>(row.value, row.value);
  }
  return map;
}

/** 读取全局配置，缺失字段用默认值补齐。 */
export function getAppSettings(): AppSettings {
  const map = readSettingsMap();
  return {
    ...DEFAULT_APP_SETTINGS,
    ...map,
    budget: { ...DEFAULT_BUDGET, ...(map.budget as Partial<ContextBudget> | undefined) },
  } as AppSettings;
}

/** 局部更新全局配置。 */
export function updateAppSettings(patch: Partial<AppSettings>): AppSettings {
  const db = getDb();
  const statement = db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  const apply = db.transaction((entries: Array<[string, unknown]>) => {
    for (const [key, value] of entries) {
      statement.run(key, JSON.stringify(value), now());
    }
  });
  apply(Object.entries(patch));
  return getAppSettings();
}

/** 读取单部小说的全部配置。 */
export function getNovelPreferences(novelId: string): NovelPreferences {
  const rows = getDb()
    .prepare('SELECT key, value FROM novel_settings WHERE novel_id = ?')
    .all(novelId) as Array<{ key: string; value: string }>;
  const map: Record<string, unknown> = {};
  for (const row of rows) {
    // 文本型配置由独立的 texts 字段承载，正文以 Markdown 文件为准。
    // 这里把它们排除掉，避免同一个响应里出现两套可能冲突的文本值，
    // 也避免调用方把空串回写覆盖用户真实内容。
    if (isNovelTextKey(row.key)) continue;
    map[row.key] = parseJson<unknown>(row.value, row.value);
  }
  const rules = map.rules as Partial<GenerationRules> | undefined;
  const budget = map.budget as Partial<ContextBudget> | undefined;
  return {
    ...DEFAULT_PREFERENCES,
    ...map,
    rules: { ...DEFAULT_RULES, ...rules },
    budget: { ...DEFAULT_BUDGET, ...budget },
  } as NovelPreferences;
}

/** 更新单部小说的配置。 */
export function updateNovelPreferences(
  novelId: string,
  patch: Partial<NovelPreferences>,
): NovelPreferences {
  const db = getDb();
  const statement = db.prepare(
    `INSERT INTO novel_settings (novel_id, key, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(novel_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  const apply = db.transaction((entries: Array<[string, unknown]>) => {
    for (const [key, value] of entries) {
      statement.run(novelId, key, JSON.stringify(value), now());
    }
  });
  apply(Object.entries(patch));
  return getNovelPreferences(novelId);
}

/** 写入小说的一项任意配置。 */
export function setNovelValue(novelId: string, key: string, value: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO novel_settings (novel_id, key, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(novel_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(novelId, key, JSON.stringify(value), now());
}

/** 读取小说的一项原始文本配置，例如设定与世界观。 */
export function getNovelText(novelId: string, key: string, fallback = ''): string {
  const row = getDb()
    .prepare('SELECT value FROM novel_settings WHERE novel_id = ? AND key = ?')
    .get(novelId, key) as { value: string } | undefined;
  if (!row) return fallback;
  const parsed = parseJson<unknown>(row.value, row.value);
  return typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
}

/** 写入小说的一项文本配置。 */
export function setNovelText(novelId: string, key: string, value: string): void {
  setNovelValue(novelId, key, value);
}

/**
 * 内置文本配置键。
 *
 * 键名即库中存储的字段名，同时也是接口请求体中的字段名，
 * 两处必须保持一致，否则写入会被静默跳过。
 * 这些键的正文以 Markdown 文件保存，数据库仅作为兜底副本。
 */
export const NOVEL_TEXT_KEYS = {
  worldview: 'worldview',
  setting: 'setting',
  outlineOverview: 'outlineOverview',
  endingPlan: 'endingPlan',
  styleSample: 'styleSample',
} as const;

/** 文本键的类型。 */
export type NovelTextKey = (typeof NOVEL_TEXT_KEYS)[keyof typeof NOVEL_TEXT_KEYS];

/**
 * 历史上用下划线写法的文本键，读取与写入都要一并识别。
 *
 * 早期版本的常量值写成 outline_overview 这类形式，误写进了库。
 * 迁移会把它们归一，但已存在的存量数据、以及缓存了旧代码的进程仍可能产出这些键，
 * 因此判断逻辑同时覆盖两种写法，做到读写都不漏。
 */
const LEGACY_TEXT_KEYS = new Set([
  'outline_overview',
  'ending_plan',
  'style_sample',
  'world_view',
]);

const TEXT_KEY_SET: ReadonlySet<string> = new Set<string>([
  ...Object.values(NOVEL_TEXT_KEYS),
  ...LEGACY_TEXT_KEYS,
]);

/** 判断一个配置键是否属于文本型配置，兼容早期的下划线写法。 */
export function isNovelTextKey(key: string): boolean {
  return TEXT_KEY_SET.has(key);
}

/**
 * 读取一项小说文本配置，优先取设定目录下的 Markdown 文件。
 *
 * 设定与规则的正文以文件为准，数据库副本只在该文件缺失时兜底，
 * 这样用户直接用编辑器修改文件也能被生成流程读到。
 */
export function readNovelText(novelId: string, key: NovelTextKey, fallback = ''): string {
  const fromFile = readSetupFile(novelId, key);
  if (fromFile !== null) return fromFile;
  return getNovelText(novelId, key, fallback);
}
