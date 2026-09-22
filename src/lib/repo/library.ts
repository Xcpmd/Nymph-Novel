import { getDb, now, parseJson, transact } from '../db';
import { decryptSecret, encryptSecret, maskSecret, shortId } from '../crypto';
import type {
  Bookmark,
  ModelParams,
  PromptTemplate,
  Provider,
  ProviderPresetId,
  Tag,
  TaskType,
  UsageLog,
} from '../types';

/* --------------------------------------------------------------- 标签 */

/** 列出小说内的标签。 */
export function listTags(novelId: string): Tag[] {
  const rows = getDb()
    .prepare('SELECT * FROM tags WHERE novel_id = ? ORDER BY name')
    .all(novelId) as Array<{ id: string; novel_id: string; name: string; color: string; created_at: string }>;
  return rows.map((row) => ({
    id: row.id,
    novelId: row.novel_id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
  }));
}

/** 按名称取得或创建标签。 */
export function ensureTag(novelId: string, name: string, color = ''): Tag {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('标签名不能为空');
  const existing = getDb()
    .prepare('SELECT * FROM tags WHERE novel_id = ? AND name = ?')
    .get(novelId, trimmed) as
    | { id: string; novel_id: string; name: string; color: string; created_at: string }
    | undefined;
  if (existing) {
    return {
      id: existing.id,
      novelId: existing.novel_id,
      name: existing.name,
      color: existing.color,
      createdAt: existing.created_at,
    };
  }
  const id = shortId('tag');
  const timestamp = now();
  getDb()
    .prepare('INSERT INTO tags (id, novel_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, novelId, trimmed, color, timestamp);
  return { id, novelId, name: trimmed, color, createdAt: timestamp };
}

/** 删除标签，同时解除与章节的关联。 */
export function deleteTag(tagId: string): void {
  getDb().prepare('DELETE FROM tags WHERE id = ?').run(tagId);
}

/** 覆盖设置某章节的标签集合。 */
export function setChapterTags(chapterId: string, tagNames: string[], novelId: string): void {
  transact(() => {
    getDb().prepare('DELETE FROM chapter_tags WHERE chapter_id = ?').run(chapterId);
    for (const name of tagNames) {
      const tag = ensureTag(novelId, name);
      getDb()
        .prepare('INSERT OR IGNORE INTO chapter_tags (chapter_id, tag_id) VALUES (?, ?)')
        .run(chapterId, tag.id);
    }
  });
}

/** 读取某章节的标签。 */
export function getChapterTags(chapterId: string): Tag[] {
  const rows = getDb()
    .prepare(
      `SELECT t.* FROM tags t JOIN chapter_tags ct ON ct.tag_id = t.id WHERE ct.chapter_id = ? ORDER BY t.name`,
    )
    .all(chapterId) as Array<{ id: string; novel_id: string; name: string; color: string; created_at: string }>;
  return rows.map((row) => ({
    id: row.id,
    novelId: row.novel_id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
  }));
}

/** 按标签筛选章节 id。 */
export function listChapterIdsByTag(novelId: string, tagId: string): string[] {
  const rows = getDb()
    .prepare(
      `SELECT ct.chapter_id FROM chapter_tags ct
       JOIN chapters c ON c.id = ct.chapter_id
       WHERE c.novel_id = ? AND ct.tag_id = ?`,
    )
    .all(novelId, tagId) as Array<{ chapter_id: string }>;
  return rows.map((row) => row.chapter_id);
}

/* ------------------------------------------------------------- 书签 */

/** 列出小说内的书签，附带章节标题与位置。 */
export function listBookmarks(novelId: string): Bookmark[] {
  const rows = getDb()
    .prepare(
      `SELECT b.*, c.title AS chapter_title, v.index_no AS volume_index, c.index_no AS chapter_index
       FROM bookmarks b
       JOIN chapters c ON c.id = b.chapter_id
       JOIN volumes v ON v.id = c.volume_id
       WHERE b.novel_id = ? ORDER BY b.created_at DESC`,
    )
    .all(novelId) as Array<{
    id: string;
    novel_id: string;
    chapter_id: string;
    label: string;
    anchor: string;
    note: string;
    created_at: string;
    chapter_title: string;
    volume_index: number;
    chapter_index: number;
  }>;
  return rows.map((row) => ({
    id: row.id,
    novelId: row.novel_id,
    chapterId: row.chapter_id,
    label: row.label,
    anchor: row.anchor,
    note: row.note,
    createdAt: row.created_at,
    chapterTitle: row.chapter_title,
    volumeIndex: row.volume_index,
    chapterIndex: row.chapter_index,
  }));
}

/** 新增书签。 */
export function createBookmark(
  novelId: string,
  input: { chapterId: string; label?: string; anchor?: string; note?: string },
): Bookmark {
  const id = shortId('bkm');
  getDb()
    .prepare(
      `INSERT INTO bookmarks (id, novel_id, chapter_id, label, anchor, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      novelId,
      input.chapterId,
      input.label ?? '',
      input.anchor ?? '',
      input.note ?? '',
      now(),
    );
  return listBookmarks(novelId).find((item) => item.id === id)!;
}

/** 删除书签。 */
export function deleteBookmark(bookmarkId: string): void {
  getDb().prepare('DELETE FROM bookmarks WHERE id = ?').run(bookmarkId);
}

/* --------------------------------------------------- 供应商与模型接入 */

interface ProviderRow {
  id: string;
  name: string;
  preset_id: string | null;
  base_url: string;
  api_key_encrypted: string;
  default_model: string;
  models: string;
  params: string;
  stream: number;
  max_retries: number;
  enabled: number;
  is_active: number;
  sort_no: number;
  created_at: string;
  updated_at: string;
}

/**
 * 把数据库行转换为对外的供应商对象。
 * API Key 永远以密文形式留在数据库，只在服务端按需解密；
 * 返回给界面时只给掩码，避免明文出现在浏览器内存里。
 */
function mapProvider(row: ProviderRow): Provider {
  let masked = '';
  try {
    masked = maskSecret(decryptSecret(row.api_key_encrypted));
  } catch {
    masked = '（密钥无法解密，请重新填写）';
  }
  return {
    id: row.id,
    name: row.name,
    presetId: (row.preset_id ?? 'custom') as ProviderPresetId,
    baseUrl: row.base_url,
    apiKeyMasked: masked,
    hasApiKey: row.api_key_encrypted.length > 0,
    defaultModel: row.default_model,
    models: parseJson<string[]>(row.models, []),
    params: parseJson<ModelParams>(row.params, {}),
    stream: row.stream === 1,
    maxRetries: row.max_retries,
    enabled: row.enabled === 1,
    isActive: row.is_active === 1,
    sortNo: row.sort_no,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 列出全部供应商，仅返回掩码后的密钥。 */
export function listProviders(): Provider[] {
  const rows = getDb()
    .prepare('SELECT * FROM providers ORDER BY sort_no, created_at')
    .all() as ProviderRow[];
  return rows.map(mapProvider);
}

/** 读取单个供应商，返回掩码版本。 */
export function getProvider(providerId: string): Provider | null {
  const row = getDb().prepare('SELECT * FROM providers WHERE id = ?').get(providerId) as
    | ProviderRow
    | undefined;
  return row ? mapProvider(row) : null;
}

/**
 * 读取供应商的明文密钥，仅供服务端调用模型时使用。
 * 该函数不得在返回给浏览器的数据结构中调用。
 */
export function getProviderSecret(providerId: string): string {
  const row = getDb()
    .prepare('SELECT api_key_encrypted FROM providers WHERE id = ?')
    .get(providerId) as { api_key_encrypted: string } | undefined;
  if (!row || !row.api_key_encrypted) return '';
  try {
    return decryptSecret(row.api_key_encrypted);
  } catch {
    return '';
  }
}

/** 取得当前激活的供应商，未显式设置时取第一个可用的。 */
export function getActiveProvider(): Provider | null {
  const rows = getDb()
    .prepare('SELECT * FROM providers WHERE enabled = 1 ORDER BY is_active DESC, sort_no, created_at')
    .all() as ProviderRow[];
  if (rows.length === 0) return null;
  return mapProvider(rows[0]!);
}

export interface ProviderInput {
  name: string;
  presetId?: ProviderPresetId;
  baseUrl: string;
  apiKey?: string;
  defaultModel?: string;
  models?: string[];
  params?: ModelParams;
  stream?: boolean;
  maxRetries?: number;
  enabled?: boolean;
  isActive?: boolean;
}

/** 新建供应商。 */
export function createProvider(input: ProviderInput): Provider {
  const max = getDb().prepare('SELECT COALESCE(MAX(sort_no), 0) AS maxSort FROM providers').get() as {
    maxSort: number;
  };
  const id = shortId('prv');
  const timestamp = now();
  getDb()
    .prepare(
      `INSERT INTO providers (id, name, preset_id, base_url, api_key_encrypted, default_model,
         models, params, stream, max_retries, enabled, is_active, sort_no, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name,
      input.presetId ?? 'custom',
      input.baseUrl,
      input.apiKey ? encryptSecret(input.apiKey) : '',
      input.defaultModel ?? '',
      JSON.stringify(input.models ?? []),
      JSON.stringify(input.params ?? {}),
      input.stream === false ? 0 : 1,
      input.maxRetries ?? 2,
      input.enabled === false ? 0 : 1,
      0,
      max.maxSort + 1,
      timestamp,
      timestamp,
    );
  if (input.isActive) setActiveProvider(id);
  return getProvider(id)!;
}

export interface ProviderPatch extends Partial<ProviderInput> {
  /** 传空字符串表示清除密钥，传 undefined 表示保持不变 */
  apiKey?: string;
}

/** 更新供应商；apiKey 为 undefined 时不改动已保存的密钥。 */
export function updateProvider(providerId: string, patch: ProviderPatch): Provider | null {
  const fields: string[] = [];
  const values: unknown[] = [];
  const assign = (column: string, value: unknown) => {
    fields.push(`${column} = ?`);
    values.push(value);
  };
  if (patch.name !== undefined) assign('name', patch.name);
  if (patch.presetId !== undefined) assign('preset_id', patch.presetId);
  if (patch.baseUrl !== undefined) assign('base_url', patch.baseUrl);
  if (patch.apiKey !== undefined) {
    assign('api_key_encrypted', patch.apiKey ? encryptSecret(patch.apiKey) : '');
  }
  if (patch.defaultModel !== undefined) assign('default_model', patch.defaultModel);
  if (patch.models !== undefined) assign('models', JSON.stringify(patch.models));
  if (patch.params !== undefined) assign('params', JSON.stringify(patch.params));
  if (patch.stream !== undefined) assign('stream', patch.stream ? 1 : 0);
  if (patch.maxRetries !== undefined) assign('max_retries', patch.maxRetries);
  if (patch.enabled !== undefined) assign('enabled', patch.enabled ? 1 : 0);
  if (fields.length > 0) {
    assign('updated_at', now());
    getDb()
      .prepare(`UPDATE providers SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values, providerId);
  }
  if (patch.isActive) setActiveProvider(providerId);
  return getProvider(providerId);
}

/** 将指定供应商设为当前使用。 */
export function setActiveProvider(providerId: string): void {
  transact(() => {
    getDb().prepare('UPDATE providers SET is_active = 0, updated_at = ?').run(now());
    getDb()
      .prepare('UPDATE providers SET is_active = 1, enabled = 1, updated_at = ? WHERE id = ?')
      .run(now(), providerId);
  });
  getDb()
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('activeProviderId', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(JSON.stringify(providerId), now());
}

/** 删除供应商。 */
export function deleteProvider(providerId: string): void {
  getDb().prepare('DELETE FROM providers WHERE id = ?').run(providerId);
}

/* --------------------------------------------------------- 提示词模板 */

interface PromptRow {
  id: string;
  provider_id: string | null;
  task_type: string;
  system_prompt: string;
  user_prompt: string;
  temperature: number | null;
  is_builtin: number;
  created_at: string;
  updated_at: string;
}

function mapPrompt(row: PromptRow): PromptTemplate {
  return {
    id: row.id,
    providerId: row.provider_id,
    taskType: row.task_type as TaskType,
    systemPrompt: row.system_prompt,
    userPrompt: row.user_prompt,
    temperature: row.temperature,
    isBuiltin: row.is_builtin === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 列出用户覆盖过的提示词模板。 */
export function listPromptTemplates(providerId?: string | null): PromptTemplate[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM prompt_templates
       WHERE (? IS NULL AND provider_id IS NULL) OR provider_id = ?
       ORDER BY task_type`,
    )
    .all(providerId ?? null, providerId ?? null) as PromptRow[];
  return rows.map(mapPrompt);
}

/** 读取某个任务在指定供应商下的自定义模板，没有则返回 null 表示使用内置模板。 */
export function getPromptTemplate(taskType: TaskType, providerId?: string | null): PromptTemplate | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM prompt_templates
       WHERE task_type = ? AND COALESCE(provider_id, '') = COALESCE(?, '')`,
    )
    .get(taskType, providerId ?? null) as PromptRow | undefined;
  return row ? mapPrompt(row) : null;
}

/** 写入或覆盖提示词模板。 */
export function upsertPromptTemplate(input: {
  taskType: TaskType;
  providerId?: string | null;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number | null;
}): PromptTemplate {
  const providerId = input.providerId ?? null;
  const id = shortId('pmt');
  const timestamp = now();
  getDb()
    .prepare(
      `INSERT INTO prompt_templates (id, provider_id, task_type, system_prompt, user_prompt,
         temperature, is_builtin, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(task_type, COALESCE(provider_id, '')) DO UPDATE SET
         system_prompt = excluded.system_prompt,
         user_prompt = excluded.user_prompt,
         temperature = excluded.temperature,
         updated_at = excluded.updated_at`,
    )
    .run(
      id,
      providerId,
      input.taskType,
      input.systemPrompt,
      input.userPrompt,
      input.temperature ?? null,
      timestamp,
      timestamp,
    );
  return getPromptTemplate(input.taskType, providerId)!;
}

/** 删除自定义模板，回退到内置模板。 */
export function deletePromptTemplate(taskType: TaskType, providerId?: string | null): void {
  getDb()
    .prepare(
      `DELETE FROM prompt_templates WHERE task_type = ? AND COALESCE(provider_id, '') = COALESCE(?, '')`,
    )
    .run(taskType, providerId ?? null);
}

/* --------------------------------------------------------- 用量统计 */

export function recordUsage(input: {
  novelId?: string | null;
  chapterId?: string | null;
  providerId?: string | null;
  providerName?: string;
  model?: string;
  taskType?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated: boolean;
  durationMs: number;
}): UsageLog {
  const id = shortId('usg');
  const timestamp = now();
  getDb()
    .prepare(
      `INSERT INTO usage_logs (id, novel_id, chapter_id, provider_id, provider_name, model,
         task_type, prompt_tokens, completion_tokens, total_tokens, estimated, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.novelId ?? null,
      input.chapterId ?? null,
      input.providerId ?? null,
      input.providerName ?? '',
      input.model ?? '',
      input.taskType ?? '',
      input.promptTokens,
      input.completionTokens,
      input.totalTokens,
      input.estimated ? 1 : 0,
      input.durationMs,
      timestamp,
    );
  return {
    id,
    novelId: input.novelId ?? null,
    chapterId: input.chapterId ?? null,
    providerId: input.providerId ?? null,
    providerName: input.providerName ?? '',
    model: input.model ?? '',
    taskType: input.taskType ?? '',
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    totalTokens: input.totalTokens,
    estimated: input.estimated,
    durationMs: input.durationMs,
    createdAt: timestamp,
  };
}

/** 列出用量记录。 */
export function listUsageLogs(options: { novelId?: string; limit?: number } = {}): UsageLog[] {
  const limit = options.limit ?? 200;
  const rows = options.novelId
    ? (getDb()
        .prepare('SELECT * FROM usage_logs WHERE novel_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(options.novelId, limit) as Array<Record<string, unknown>>)
    : (getDb()
        .prepare('SELECT * FROM usage_logs ORDER BY created_at DESC LIMIT ?')
        .all(limit) as Array<Record<string, unknown>>);
  return rows.map((row) => ({
    id: String(row.id),
    novelId: (row.novel_id as string | null) ?? null,
    chapterId: (row.chapter_id as string | null) ?? null,
    providerId: (row.provider_id as string | null) ?? null,
    providerName: String(row.provider_name ?? ''),
    model: String(row.model ?? ''),
    taskType: String(row.task_type ?? ''),
    promptTokens: Number(row.prompt_tokens ?? 0),
    completionTokens: Number(row.completion_tokens ?? 0),
    totalTokens: Number(row.total_tokens ?? 0),
    estimated: Number(row.estimated ?? 0) === 1,
    durationMs: Number(row.duration_ms ?? 0),
    createdAt: String(row.created_at),
  }));
}

/** 用量汇总，用于设置页与小说概览页展示。 */
export function summarizeUsage(novelId?: string): {
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  calls: number;
  byTask: Array<{ taskType: string; tokens: number; calls: number }>;
  byModel: Array<{ model: string; tokens: number; calls: number }>;
} {
  const db = getDb();
  const scope = novelId
    ? db
        .prepare(
          `SELECT COALESCE(SUM(total_tokens), 0) AS total, COALESCE(SUM(prompt_tokens), 0) AS prompt,
                  COALESCE(SUM(completion_tokens), 0) AS completion, COUNT(*) AS calls
           FROM usage_logs WHERE novel_id = ?`,
        )
        .get(novelId)
    : db
        .prepare(
          `SELECT COALESCE(SUM(total_tokens), 0) AS total, COALESCE(SUM(prompt_tokens), 0) AS prompt,
                  COALESCE(SUM(completion_tokens), 0) AS completion, COUNT(*) AS calls
           FROM usage_logs`,
        )
        .get();
  const totals = scope as { total: number; prompt: number; completion: number; calls: number };

  const groupQuery = (column: string) =>
    (novelId
      ? db
          .prepare(
            `SELECT ${column} AS label, COALESCE(SUM(total_tokens), 0) AS tokens, COUNT(*) AS calls
             FROM usage_logs WHERE novel_id = ? GROUP BY ${column} ORDER BY tokens DESC LIMIT 12`,
          )
          .all(novelId)
      : db
          .prepare(
            `SELECT ${column} AS label, COALESCE(SUM(total_tokens), 0) AS tokens, COUNT(*) AS calls
             FROM usage_logs GROUP BY ${column} ORDER BY tokens DESC LIMIT 12`,
          )
          .all()) as Array<{ label: string; tokens: number; calls: number }>;

  return {
    totalTokens: totals.total,
    promptTokens: totals.prompt,
    completionTokens: totals.completion,
    calls: totals.calls,
    byTask: groupQuery('task_type').map((row) => ({
      taskType: row.label || '未分类',
      tokens: row.tokens,
      calls: row.calls,
    })),
    byModel: groupQuery('model').map((row) => ({
      model: row.label || '未记录',
      tokens: row.tokens,
      calls: row.calls,
    })),
  };
}

/* ------------------------------------------------------ 生成任务记录 */

export interface GenerationRun {
  id: string;
  novelId: string;
  chapterId: string | null;
  taskType: TaskType;
  providerId: string | null;
  model: string;
  status: 'running' | 'paused' | 'done' | 'failed' | 'cancelled';
  requestJson: string;
  partialText: string;
  error: string;
  createdAt: string;
  updatedAt: string;
}

/** 创建生成任务记录，用于暂停后恢复。 */
export function createRun(input: {
  novelId: string;
  chapterId?: string | null;
  taskType: TaskType;
  providerId?: string | null;
  model?: string;
  request?: unknown;
}): string {
  const id = shortId('run');
  const timestamp = now();
  getDb()
    .prepare(
      `INSERT INTO generation_runs (id, novel_id, chapter_id, task_type, provider_id, model,
         status, request_json, partial_text, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'running', ?, '', '', ?, ?)`,
    )
    .run(
      id,
      input.novelId,
      input.chapterId ?? null,
      input.taskType,
      input.providerId ?? null,
      input.model ?? '',
      JSON.stringify(input.request ?? {}),
      timestamp,
      timestamp,
    );
  return id;
}

/** 更新生成任务状态与已生成内容。 */
export function updateRun(
  runId: string,
  patch: { status?: GenerationRun['status']; partialText?: string; error?: string },
): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.status !== undefined) {
    fields.push('status = ?');
    values.push(patch.status);
  }
  if (patch.partialText !== undefined) {
    fields.push('partial_text = ?');
    values.push(patch.partialText);
  }
  if (patch.error !== undefined) {
    fields.push('error = ?');
    values.push(patch.error);
  }
  if (fields.length === 0) return;
  fields.push('updated_at = ?');
  values.push(now(), runId);
  getDb()
    .prepare(`UPDATE generation_runs SET ${fields.join(', ')} WHERE id = ?`)
    .run(...values);
}

/** 读取生成任务。 */
export function getRun(runId: string): GenerationRun | null {
  const row = getDb().prepare('SELECT * FROM generation_runs WHERE id = ?').get(runId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    novelId: String(row.novel_id),
    chapterId: (row.chapter_id as string | null) ?? null,
    taskType: row.task_type as TaskType,
    providerId: (row.provider_id as string | null) ?? null,
    model: String(row.model ?? ''),
    status: row.status as GenerationRun['status'],
    requestJson: String(row.request_json ?? '{}'),
    partialText: String(row.partial_text ?? ''),
    error: String(row.error ?? ''),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/** 列出小说下最近的生成任务。 */
export function listRuns(novelId: string, limit = 30): GenerationRun[] {
  const rows = getDb()
    .prepare('SELECT * FROM generation_runs WHERE novel_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(novelId, limit) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    novelId: String(row.novel_id),
    chapterId: (row.chapter_id as string | null) ?? null,
    taskType: row.task_type as TaskType,
    providerId: (row.provider_id as string | null) ?? null,
    model: String(row.model ?? ''),
    status: row.status as GenerationRun['status'],
    requestJson: String(row.request_json ?? '{}'),
    partialText: String(row.partial_text ?? ''),
    error: String(row.error ?? ''),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }));
}

/** 清理超过指定天数的生成任务记录。 */
export function pruneRuns(olderThanDays = 14): number {
  const cutoff = new Date(Date.now() - olderThanDays * 86400_000).toISOString();
  const result = getDb().prepare('DELETE FROM generation_runs WHERE created_at < ?').run(cutoff);
  return result.changes;
}
