import { getDb, now } from '../db';
import { shortId } from '../crypto';
import { PROVIDER_PRESETS } from '../ai/presets';

/**
 * 首次运行时的初始化。
 * 数据库为空时预置常见写小说模型供应商，用户只需填入 API Key 即可开始生成。
 */

export function isFirstRun(): boolean {
  const row = getDb().prepare('SELECT COUNT(*) AS count FROM providers').get() as { count: number };
  return row.count === 0;
}

/** 按预置清单创建供应商，不覆盖任何已有配置。 */
export function ensureDefaultProviders(): number {
  const db = getDb();
  if (!isFirstRun()) return 0;

  const insert = db.prepare(
    `INSERT INTO providers (id, name, preset_id, base_url, api_key_encrypted, default_model,
       models, params, stream, max_retries, enabled, is_active, sort_no, created_at, updated_at)
     VALUES (?, ?, ?, ?, '', ?, ?, ?, 1, 2, 1, ?, ?, ?, ?)`,
  );

  const timestamp = now();
  let created = 0;
  const run = db.transaction(() => {
    PROVIDER_PRESETS.forEach((preset, index) => {
      if (preset.id === 'custom') return;
      insert.run(
        shortId('prv'),
        preset.name,
        preset.id,
        preset.baseUrl,
        preset.defaultModel,
        JSON.stringify(preset.models),
        JSON.stringify(preset.params),
        index === 0 ? 1 : 0,
        index,
        timestamp,
        timestamp,
      );
      created += 1;
    });
  });
  run();

  // 首个供应商默认激活，避免用户一进来就没有可用模型
  const first = db
    .prepare('SELECT id FROM providers ORDER BY sort_no LIMIT 1')
    .get() as { id: string } | undefined;
  if (first) {
    db.prepare('UPDATE providers SET is_active = 1 WHERE id = ?').run(first.id);
    db.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('activeProviderId', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(JSON.stringify(first.id), timestamp);
  }

  return created;
}
