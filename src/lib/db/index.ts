import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DATA_DIR, DB_FILE, NOVEL_ROOT } from '../paths';
import { migrateChapterDirsOnDisk } from '../store/chapter-files';
import { MIGRATIONS } from './schema';

export type Db = Database.Database;

/**
 * 数据库单例。
 * 挂在 globalThis 上是为了在 Next.js 开发模式的热更新中复用同一个连接，
 * 避免每次模块重载都打开一个新的文件句柄。
 */
const globalForDb = globalThis as unknown as { __nymphDb?: Db };

function runMigrations(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    const apply = db.transaction(() => {
      for (const statement of migration.statements) {
        db.exec(statement);
      }
      db.pragma(`user_version = ${migration.version}`);
    });
    apply();
    console.log(`[nymph] 数据库迁移完成：v${migration.version} ${migration.name}`);
  }
  migrateLegacyChapterDirs(db);
}

/**
 * 把磁盘上残留的中文卷章目录搬迁为拉丁写法。
 *
 * 数据库里的旧路径由 v7 迁移换算，但磁盘目录得单独改名，
 * 两边不同步就会出现库里有记录却读不到正文的情况。
 *
 * 这一步在每次启动时都执行，而不是只在迁移里跑一次：
 * 版本号一旦推进就不会回头，若首次执行时有章节文件尚未落盘，
 * 之后新增的旧目录就再也搬不动了。函数本身幂等，重复运行无副作用。
 */
function migrateLegacyChapterDirs(db: Db): void {
  let rows: Array<{ novel_id: string; rel_path: string }>;
  try {
    rows = db
      .prepare('SELECT novel_id, rel_path FROM chapters')
      .all() as Array<{ novel_id: string; rel_path: string }>;
  } catch {
    // 表结构还没建好时直接跳过，不阻塞启动
    return;
  }

  const byNovel = new Map<string, Set<string>>();
  for (const row of rows) {
    // 两种候选都给：库里的原值，以及它的中文还原形式。
    // 无论库里存的是哪一套命名，都能定位到磁盘上的旧目录。
    const set = byNovel.get(row.novel_id) ?? new Set<string>();
    set.add(row.rel_path);
    const legacy = legacyFromLatin(row.rel_path);
    if (legacy !== row.rel_path) set.add(legacy);
    byNovel.set(row.novel_id, set);
  }

  let total = 0;
  for (const [novelId, candidates] of byNovel) {
    try {
      total += migrateChapterDirsOnDisk(novelId, [...candidates]);
    } catch (error) {
      console.warn(
        `[nymph] 旧章节目录迁移失败，已跳过：${novelId} ${error instanceof Error ? error.message : ''}`,
      );
    }
  }
  if (total > 0) {
    console.log(`[nymph] 已把 ${total} 个中文章节目录迁移为拉丁命名`);
  }
}

/** 把拉丁路径还原成早期中文路径，用于定位磁盘上的旧目录。 */
function legacyFromLatin(relPath: string): string {
  return relPath
    .replace(/^vol-/, '卷-')
    .replace(/\/ch-/g, '/章-')
    .replace(/\/content\.md$/, '/正文.md');
}

/** 获取数据库连接，首次调用时建库、建表并执行迁移。 */
export function getDb(): Db {
  if (globalForDb.__nymphDb) return globalForDb.__nymphDb;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(NOVEL_ROOT, { recursive: true });

  const db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  runMigrations(db);

  globalForDb.__nymphDb = db;
  return db;
}

/** 当前数据库结构版本，用于界面展示与自检。 */
export function getSchemaVersion(): number {
  return getDb().pragma('user_version', { simple: true }) as number;
}

/** 数据库文件在磁盘上的占用，用于设置页展示。 */
export function getDatabaseSize(): number {
  let total = 0;
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${DB_FILE}${suffix}`;
    // 数据库路径由运行环境决定，构建期无法静态确定，因此跳过输出追踪
    if (fs.existsSync(/* turbopackIgnore: true */ file)) {
      total += fs.statSync(/* turbopackIgnore: true */ file).size;
    }
  }
  return total;
}

/** 数据目录的绝对路径。 */
export function getDataDir(): string {
  return DATA_DIR;
}

/** 当前时间戳，统一使用 ISO 字符串存储，便于排序与展示。 */
export function now(): string {
  return new Date().toISOString();
}

/** 在事务中执行一段逻辑。 */
export function transact<T>(fn: () => T): T {
  return getDb().transaction(fn)();
}

/** 将数据库行中的 0/1 转成布尔值。 */
export function toBool(value: unknown): boolean {
  return value === 1 || value === true;
}

/** 将布尔值转成数据库中的 0/1。 */
export function fromBool(value: boolean | undefined, fallback = false): number {
  return (value ?? fallback) ? 1 : 0;
}

/** 安全解析 JSON 字段，解析失败时返回兜底值，避免一条脏数据打挂整个页面。 */
export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || raw.length === 0) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export { DB_FILE, path };
