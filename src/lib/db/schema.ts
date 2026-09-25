/**
 * 数据库结构定义。
 *
 * 迁移以 user_version 为版本号顺序执行，每一步都是幂等的 SQL 语句集合。
 * 新增结构时在数组末尾追加一个版本，不要修改已发布版本的内容。
 */

import fs from 'node:fs';
import path from 'node:path';
import { NOVEL_ROOT } from '../paths';

export interface Migration {
  version: number;
  name: string;
  statements: string[];
  /**
   * 需要判断后再执行的迁移步骤，在全部语句之后运行。
   *
   * SQLite 有一批操作无法写成幂等语句，例如 ALTER TABLE ADD COLUMN
   * 在列已存在时会直接报错，而迁移可能被多个版本的程序各跑一次。
   * 这类步骤放在这里，由代码检查现状后再决定是否执行。
   */
  run?: (db: import('better-sqlite3').Database) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: '初始化核心表结构',
    statements: [
      // 全局配置：主题色相、当前语言、当前供应商、上下文预算等
      `CREATE TABLE IF NOT EXISTS app_settings (
         key TEXT PRIMARY KEY,
         value TEXT NOT NULL,
         updated_at TEXT NOT NULL
       )`,

      // 模型供应商与接入配置，API Key 以 AES-256-GCM 密文存储
      `CREATE TABLE IF NOT EXISTS providers (
         id TEXT PRIMARY KEY,
         name TEXT NOT NULL,
         preset_id TEXT,
         base_url TEXT NOT NULL,
         api_key_encrypted TEXT NOT NULL DEFAULT '',
         default_model TEXT NOT NULL DEFAULT '',
         models TEXT NOT NULL DEFAULT '[]',
         params TEXT NOT NULL DEFAULT '{}',
         stream INTEGER NOT NULL DEFAULT 1,
         max_retries INTEGER NOT NULL DEFAULT 2,
         enabled INTEGER NOT NULL DEFAULT 1,
         is_active INTEGER NOT NULL DEFAULT 0,
         sort_no INTEGER NOT NULL DEFAULT 0,
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL
       )`,

      // 小说主表
      `CREATE TABLE IF NOT EXISTS novels (
         id TEXT PRIMARY KEY,
         title TEXT NOT NULL,
         author TEXT NOT NULL DEFAULT '',
         genre TEXT NOT NULL DEFAULT '',
         summary TEXT NOT NULL DEFAULT '',
         cover_emoji TEXT NOT NULL DEFAULT '📖',
         status TEXT NOT NULL DEFAULT 'drafting',
         word_count INTEGER NOT NULL DEFAULT 0,
         chapter_count INTEGER NOT NULL DEFAULT 0,
         volume_count INTEGER NOT NULL DEFAULT 0,
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL
       )`,

      // 小说级键值配置：设定、世界观、历法、生成规则、字数目标等
      `CREATE TABLE IF NOT EXISTS novel_settings (
         novel_id TEXT NOT NULL,
         key TEXT NOT NULL,
         value TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         PRIMARY KEY (novel_id, key),
         FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
       )`,

      // 卷
      `CREATE TABLE IF NOT EXISTS volumes (
         id TEXT PRIMARY KEY,
         novel_id TEXT NOT NULL,
         index_no INTEGER NOT NULL,
         title TEXT NOT NULL,
         summary TEXT NOT NULL DEFAULT '',
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
         UNIQUE (novel_id, index_no)
       )`,

      // 章：正文实体存放在 Markdown 文件，这里只存元数据、概括与时间字段
      `CREATE TABLE IF NOT EXISTS chapters (
         id TEXT PRIMARY KEY,
         novel_id TEXT NOT NULL,
         volume_id TEXT NOT NULL,
         index_no INTEGER NOT NULL,
         title TEXT NOT NULL,
         rel_path TEXT NOT NULL,
         status TEXT NOT NULL DEFAULT 'planned',
         word_count INTEGER NOT NULL DEFAULT 0,
         summary TEXT NOT NULL DEFAULT '',
         summary_level TEXT NOT NULL DEFAULT 'normal',
         plot_impact TEXT NOT NULL DEFAULT '',
         importance INTEGER NOT NULL DEFAULT 3,
         timeline_time TEXT NOT NULL DEFAULT '',
         timeline_sort TEXT NOT NULL DEFAULT '',
         branch_id TEXT,
         direction TEXT NOT NULL DEFAULT '',
         notes TEXT NOT NULL DEFAULT '',
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
         FOREIGN KEY (volume_id) REFERENCES volumes(id) ON DELETE CASCADE,
         UNIQUE (volume_id, index_no)
       )`,
      `CREATE INDEX IF NOT EXISTS idx_chapters_novel ON chapters(novel_id, volume_id, index_no)`,

      // 大纲：树状结构，arc 为卷级大弧，beat 为情节节点，sub 为细分节点
      `CREATE TABLE IF NOT EXISTS outline_nodes (
         id TEXT PRIMARY KEY,
         novel_id TEXT NOT NULL,
         parent_id TEXT,
         kind TEXT NOT NULL DEFAULT 'beat',
         order_no INTEGER NOT NULL DEFAULT 0,
         title TEXT NOT NULL,
         content TEXT NOT NULL DEFAULT '',
         status TEXT NOT NULL DEFAULT 'planned',
         chapter_id TEXT,
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
       )`,
      `CREATE INDEX IF NOT EXISTS idx_outline_novel ON outline_nodes(novel_id, parent_id, order_no)`,

      // 角色图鉴
      `CREATE TABLE IF NOT EXISTS characters (
         id TEXT PRIMARY KEY,
         novel_id TEXT NOT NULL,
         name TEXT NOT NULL,
         aliases TEXT NOT NULL DEFAULT '[]',
         emoji TEXT NOT NULL DEFAULT '🙂',
         role_type TEXT NOT NULL DEFAULT 'supporting',
         gender TEXT NOT NULL DEFAULT '',
         age TEXT NOT NULL DEFAULT '',
         faction TEXT NOT NULL DEFAULT '',
         personality TEXT NOT NULL DEFAULT '',
         appearance TEXT NOT NULL DEFAULT '',
         ability TEXT NOT NULL DEFAULT '',
         background TEXT NOT NULL DEFAULT '',
         arc TEXT NOT NULL DEFAULT '',
         foreshadowing TEXT NOT NULL DEFAULT '[]',
         tags TEXT NOT NULL DEFAULT '[]',
         notes TEXT NOT NULL DEFAULT '',
         sort_no INTEGER NOT NULL DEFAULT 0,
         is_primary INTEGER NOT NULL DEFAULT 0,
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
       )`,
      `CREATE INDEX IF NOT EXISTS idx_characters_novel ON characters(novel_id, role_type, sort_no)`,

      // 角色关系网
      `CREATE TABLE IF NOT EXISTS character_relations (
         id TEXT PRIMARY KEY,
         novel_id TEXT NOT NULL,
         from_character_id TEXT NOT NULL,
         to_character_id TEXT NOT NULL,
         kind TEXT NOT NULL DEFAULT 'other',
         label TEXT NOT NULL DEFAULT '',
         bidirectional INTEGER NOT NULL DEFAULT 1,
         strength INTEGER NOT NULL DEFAULT 3,
         notes TEXT NOT NULL DEFAULT '',
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
         FOREIGN KEY (from_character_id) REFERENCES characters(id) ON DELETE CASCADE,
         FOREIGN KEY (to_character_id) REFERENCES characters(id) ON DELETE CASCADE
       )`,
      `CREATE INDEX IF NOT EXISTS idx_relations_novel ON character_relations(novel_id)`,

      // 百科全书
      `CREATE TABLE IF NOT EXISTS encyclopedia_entries (
         id TEXT PRIMARY KEY,
         novel_id TEXT NOT NULL,
         category TEXT NOT NULL DEFAULT '其他',
         name TEXT NOT NULL,
         aliases TEXT NOT NULL DEFAULT '',
         summary TEXT NOT NULL DEFAULT '',
         content TEXT NOT NULL DEFAULT '',
         tags TEXT NOT NULL DEFAULT '[]',
         source_chapter_id TEXT,
         sort_no INTEGER NOT NULL DEFAULT 0,
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
       )`,
      `CREATE INDEX IF NOT EXISTS idx_encyclopedia_novel ON encyclopedia_entries(novel_id, category, sort_no)`,

      // 时间轴分支：主线、平行宇宙、穿越支线
      `CREATE TABLE IF NOT EXISTS timeline_branches (
         id TEXT PRIMARY KEY,
         novel_id TEXT NOT NULL,
         name TEXT NOT NULL,
         parent_branch_id TEXT,
         fork_event_id TEXT,
         merge_event_id TEXT,
         is_main INTEGER NOT NULL DEFAULT 0,
         color TEXT NOT NULL DEFAULT '',
         description TEXT NOT NULL DEFAULT '',
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
       )`,
      `CREATE INDEX IF NOT EXISTS idx_branches_novel ON timeline_branches(novel_id)`,

      // 时间轴事件：使用小说内历法排序，可绑定章节
      `CREATE TABLE IF NOT EXISTS timeline_events (
         id TEXT PRIMARY KEY,
         novel_id TEXT NOT NULL,
         branch_id TEXT NOT NULL,
         chapter_id TEXT,
         order_no INTEGER NOT NULL DEFAULT 0,
         novel_time TEXT NOT NULL DEFAULT '',
         title TEXT NOT NULL,
         description TEXT NOT NULL DEFAULT '',
         impact TEXT NOT NULL DEFAULT '',
         kind TEXT NOT NULL DEFAULT 'plot',
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
         FOREIGN KEY (branch_id) REFERENCES timeline_branches(id) ON DELETE CASCADE
       )`,
      `CREATE INDEX IF NOT EXISTS idx_events_novel ON timeline_events(novel_id, branch_id, order_no)`,

      // 标签与章节标签
      `CREATE TABLE IF NOT EXISTS tags (
         id TEXT PRIMARY KEY,
         novel_id TEXT NOT NULL,
         name TEXT NOT NULL,
         color TEXT NOT NULL DEFAULT '',
         created_at TEXT NOT NULL,
         UNIQUE (novel_id, name),
         FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
       )`,
      `CREATE TABLE IF NOT EXISTS chapter_tags (
         chapter_id TEXT NOT NULL,
         tag_id TEXT NOT NULL,
         PRIMARY KEY (chapter_id, tag_id),
         FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
         FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
       )`,

      // 书签
      `CREATE TABLE IF NOT EXISTS bookmarks (
         id TEXT PRIMARY KEY,
         novel_id TEXT NOT NULL,
         chapter_id TEXT NOT NULL,
         label TEXT NOT NULL DEFAULT '',
         anchor TEXT NOT NULL DEFAULT '',
         note TEXT NOT NULL DEFAULT '',
         created_at TEXT NOT NULL,
         FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
         FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
       )`,
      `CREATE INDEX IF NOT EXISTS idx_bookmarks_novel ON bookmarks(novel_id, created_at)`,

      // 提示词模板：provider_id 为空表示全局默认，否则表示按模型定制
      `CREATE TABLE IF NOT EXISTS prompt_templates (
         id TEXT PRIMARY KEY,
         provider_id TEXT,
         task_type TEXT NOT NULL,
         system_prompt TEXT NOT NULL DEFAULT '',
         user_prompt TEXT NOT NULL DEFAULT '',
         temperature REAL,
         is_builtin INTEGER NOT NULL DEFAULT 0,
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL
       )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS ux_prompt_templates
         ON prompt_templates(task_type, COALESCE(provider_id, ''))`,

      // 生成任务记录：支持暂停与恢复
      `CREATE TABLE IF NOT EXISTS generation_runs (
         id TEXT PRIMARY KEY,
         novel_id TEXT NOT NULL,
         chapter_id TEXT,
         task_type TEXT NOT NULL,
         provider_id TEXT,
         model TEXT NOT NULL DEFAULT '',
         status TEXT NOT NULL DEFAULT 'running',
         request_json TEXT NOT NULL DEFAULT '{}',
         partial_text TEXT NOT NULL DEFAULT '',
         error TEXT NOT NULL DEFAULT '',
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS idx_runs_novel ON generation_runs(novel_id, created_at)`,

      // token 用量统计
      `CREATE TABLE IF NOT EXISTS usage_logs (
         id TEXT PRIMARY KEY,
         novel_id TEXT,
         chapter_id TEXT,
         provider_id TEXT,
         provider_name TEXT NOT NULL DEFAULT '',
         model TEXT NOT NULL DEFAULT '',
         task_type TEXT NOT NULL DEFAULT '',
         prompt_tokens INTEGER NOT NULL DEFAULT 0,
         completion_tokens INTEGER NOT NULL DEFAULT 0,
         total_tokens INTEGER NOT NULL DEFAULT 0,
         estimated INTEGER NOT NULL DEFAULT 0,
         duration_ms INTEGER NOT NULL DEFAULT 0,
         created_at TEXT NOT NULL
       )`,
      `CREATE INDEX IF NOT EXISTS idx_usage_novel ON usage_logs(novel_id, created_at)`,

      // 全文检索索引，trigram 分词对中文子串检索友好
      `CREATE VIRTUAL TABLE IF NOT EXISTS chapter_fts USING fts5(
         chapter_id UNINDEXED,
         novel_id UNINDEXED,
         title,
         content,
         tokenize='trigram'
       )`,
    ],
  },
  {
    version: 2,
    name: '事件大纲替换章节概括',
    statements: [
      // 故事事件：一个事件承载一份完整大纲，大纲由若干步骤组成，逐章推进
      `CREATE TABLE IF NOT EXISTS story_events (
         id TEXT PRIMARY KEY,
         novel_id TEXT NOT NULL,
         branch_id TEXT NOT NULL,
         volume_id TEXT,
         order_no INTEGER NOT NULL DEFAULT 0,
         title TEXT NOT NULL,
         novel_time TEXT NOT NULL DEFAULT '',
         time_sort TEXT NOT NULL DEFAULT '',
         outline TEXT NOT NULL DEFAULT '',
         steps TEXT NOT NULL DEFAULT '[]',
         progress INTEGER NOT NULL DEFAULT 0,
         status TEXT NOT NULL DEFAULT 'active',
         user_choice TEXT NOT NULL DEFAULT '',
         timeline_event_id TEXT,
         started_chapter_id TEXT,
         finished_chapter_id TEXT,
         notes TEXT NOT NULL DEFAULT '',
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
         FOREIGN KEY (branch_id) REFERENCES timeline_branches(id) ON DELETE CASCADE
       )`,
      `CREATE INDEX IF NOT EXISTS idx_story_events_novel
         ON story_events(novel_id, branch_id, order_no)`,

      // 百科查询请求：AI 在大纲阶段提出，正式写作前回填结果
      `CREATE TABLE IF NOT EXISTS encyclopedia_queries (
         id TEXT PRIMARY KEY,
         novel_id TEXT NOT NULL,
         event_id TEXT,
         keyword TEXT NOT NULL,
         reason TEXT NOT NULL DEFAULT '',
         result TEXT NOT NULL DEFAULT '',
         resolved INTEGER NOT NULL DEFAULT 0,
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
       )`,
      `CREATE INDEX IF NOT EXISTS idx_encyclopedia_queries_novel
         ON encyclopedia_queries(novel_id, resolved, created_at)`,

      // 往期事件调阅请求：AI 可申请调阅某事件涉及的全部章节，需用户放行
      `CREATE TABLE IF NOT EXISTS event_recall_requests (
         id TEXT PRIMARY KEY,
         novel_id TEXT NOT NULL,
         event_id TEXT NOT NULL,
         reason TEXT NOT NULL DEFAULT '',
         approved INTEGER NOT NULL DEFAULT 0,
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
       )`,
      `CREATE INDEX IF NOT EXISTS idx_recall_requests_novel
         ON event_recall_requests(novel_id, approved, created_at)`,
    ],
  },
  {
    version: 3,
    name: '移除章节概括字段并扩展封面与发言色',
    statements: [
      // 章节概括、影响与重要度全部由事件大纲取代
      `ALTER TABLE chapters DROP COLUMN summary`,
      `ALTER TABLE chapters DROP COLUMN summary_level`,
      `ALTER TABLE chapters DROP COLUMN plot_impact`,
      `ALTER TABLE chapters DROP COLUMN importance`,

      // 封面：保留 emoji 作为降级方案，新增自定义封面图片与填充方式
      `ALTER TABLE novels ADD COLUMN cover_image TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE novels ADD COLUMN cover_fit TEXT NOT NULL DEFAULT 'cover'`,

      // 角色发言色：存 HSL 色相值，渲染时按明暗主题组合出深浅与饱和度
      `ALTER TABLE characters ADD COLUMN speech_hue INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE characters ADD COLUMN speech_color_mode TEXT NOT NULL DEFAULT 'auto'`,

      // 主题模式与事件流程偏好
      `INSERT OR IGNORE INTO app_settings (key, value, updated_at)
         VALUES ('themeMode', 'system', datetime('now'))`,
    ],
  },
  {
    version: 4,
    name: '章节关联故事事件与大纲步进',
    statements: [
      // 章节归属某个故事事件，并记录已写到事件大纲的第几步
      `ALTER TABLE chapters ADD COLUMN event_id TEXT`,
      `ALTER TABLE chapters ADD COLUMN step_index INTEGER`,
      `CREATE INDEX IF NOT EXISTS idx_chapters_event ON chapters(event_id, step_index)`,
    ],
  },
  {
    version: 5,
    name: '时间轴条目反向关联故事事件',
    statements: [
      // 时间轴条目指向故事事件，两侧互为索引
      `ALTER TABLE timeline_events ADD COLUMN event_id TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_events_story ON timeline_events(event_id)`,
    ],
  },
  {
    version: 6,
    name: '统一小说文本配置键名',
    statements: [
      // 早期版本把大纲概览等键写成下划线形式，接口按驼峰取值会读不到，
      // 这里把历史数据归一到与接口字段一致的驼峰键名
      `UPDATE OR IGNORE novel_settings SET key = 'outlineOverview' WHERE key = 'outline_overview'`,
      `UPDATE OR IGNORE novel_settings SET key = 'endingPlan' WHERE key = 'ending_plan'`,
      `UPDATE OR IGNORE novel_settings SET key = 'styleSample' WHERE key = 'style_sample'`,
    ],
  },
  {
    version: 7,
    name: '章节路径改为拉丁写法',
    statements: [
      // 早期版本把卷章目录写成中文，跨平台迁移与打包时容易出编码问题，
      // 这里把库中记录的中文路径统一换算成拉丁写法。
      // 磁盘上的中文目录由 migrateLegacyChapterDirs 在读取时搬迁，两边同步推进。
      `UPDATE chapters SET rel_path = REPLACE(rel_path, '卷-', 'vol-') WHERE rel_path LIKE '卷-%'`,
      `UPDATE chapters SET rel_path = REPLACE(rel_path, '/章-', '/ch-') WHERE rel_path LIKE '%/章-%'`,
      `UPDATE chapters SET rel_path = REPLACE(rel_path, '/正文.md', '/content.md') WHERE rel_path LIKE '%/正文.md'`,
    ],
  },
  {
    version: 8,
    name: '百科条目改为多版本',
    statements: [
      /*
       * 条目与正文分离：条目只承载名称、分类与别名这类身份信息，
       * 正文落进独立的版本表，一次登记就是一条版本记录。
       * 这样同名条目不必重复建，也能保留被替换掉的旧稿。
       */
      `CREATE TABLE IF NOT EXISTS encyclopedia_versions (
         id TEXT PRIMARY KEY,
         entry_id TEXT NOT NULL,
         novel_id TEXT NOT NULL,
         version_no INTEGER NOT NULL,
         summary TEXT NOT NULL DEFAULT '',
         content TEXT NOT NULL DEFAULT '',
         tags TEXT NOT NULL DEFAULT '[]',
         source_chapter_id TEXT,
         origin TEXT NOT NULL DEFAULT 'manual',
         is_active INTEGER NOT NULL DEFAULT 0,
         created_at TEXT NOT NULL,
         updated_at TEXT NOT NULL,
         FOREIGN KEY (entry_id) REFERENCES encyclopedia_entries(id) ON DELETE CASCADE,
         FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
         UNIQUE (entry_id, version_no)
       )`,
      `CREATE INDEX IF NOT EXISTS idx_encyclopedia_versions_entry ON encyclopedia_versions(entry_id, version_no)`,

      /*
       * 把既有条目的正文搬成它的第一版，并直接启用。
       * 用 NOT EXISTS 判断，重复执行不会重复搬。
       */
      `INSERT INTO encyclopedia_versions (id, entry_id, novel_id, version_no, summary, content, tags, source_chapter_id, origin, is_active, created_at, updated_at)
       SELECT 'encv_' || e.id, e.id, e.novel_id, 1, e.summary, e.content, e.tags, e.source_chapter_id, 'manual', 1, e.created_at, e.updated_at
       FROM encyclopedia_entries e
       WHERE NOT EXISTS (SELECT 1 FROM encyclopedia_versions v WHERE v.entry_id = e.id)`,

      /*
       * 旧列不再读写，清空以免与版本表并存两份内容造成歧义。
       * 这里不用 DROP COLUMN：SQLite 的列删除无法写成幂等语句，
       * 而迁移可能被多个版本的程序各跑一次。
       */
      `UPDATE encyclopedia_entries SET summary = '', content = '', tags = '[]', source_chapter_id = NULL
       WHERE EXISTS (SELECT 1 FROM encyclopedia_versions v WHERE v.entry_id = encyclopedia_entries.id)`,
    ],
  },
  {
    version: 9,
    name: '废案单独记录原序号',
    statements: [],
    run: (db) => {
      /*
       * 废案原先把原位置编码进 index_no：index_no = -(偏移量 + 原序号)。
       * 同一卷内若有两个章节先后从同一个位置被废，算出的负数完全相同，
       * 会被 (volume_id, index_no) 唯一约束挡下，导致第二次设为废案失败。
       *
       * 改为单独记录原序号，index_no 只负责保证唯一。
       */
      const columns = db.prepare('PRAGMA table_info(chapters)').all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === 'original_index_no')) {
        db.exec('ALTER TABLE chapters ADD COLUMN original_index_no INTEGER');
      }
      // 历史废章没有这一列的值，回填时用原有的编码规则反推
      db.exec(
        `UPDATE chapters SET original_index_no = -(index_no + 100000)
         WHERE index_no <= -100000 AND original_index_no IS NULL`,
      );
    },
  },
  {
    version: 10,
    name: '生成任务记录补全请求与用量',
    statements: [],
    run: (db) => {
      /*
       * 请求日志要能看到实际发出去的消息与本次用量，
       * 原表只存了请求参数与输出，缺少这两项。
       * 加列不是幂等语句，先查表结构再决定是否执行。
       */
      const columns = db.prepare('PRAGMA table_info(generation_runs)').all() as Array<{
        name: string;
      }>;
      const has = (name: string) => columns.some((column) => column.name === name);
      if (!has('prompt_text')) {
        db.exec(`ALTER TABLE generation_runs ADD COLUMN prompt_text TEXT NOT NULL DEFAULT ''`);
      }
      if (!has('usage_json')) {
        db.exec(`ALTER TABLE generation_runs ADD COLUMN usage_json TEXT NOT NULL DEFAULT ''`);
      }
    },
  },
  {
    version: 11,
    name: '废案章序号归入负数保留区',
    statements: [],
    run: (db) => {
      /*
       * 废案章的序号本应落在负数保留区（小于等于负十万），与正常章的正序号互不干涉。
       * 早期数据里它们仍停在正常序号段，于是重排时正常章要写回的位置被它们占着，
       * 一废案就撞 UNIQUE(volume_id, index_no)。这里按卷把它们重新编号到保留区。
       *
       * 数值与 SCRAPPED_INDEX_OFFSET 对应，迁移层不便反向依赖仓储层，因此就地写明。
       */
      const OFFSET = 100000;
      const TEMP_BASE = 200000;

      const volumes = db.prepare('SELECT DISTINCT volume_id FROM chapters').all() as Array<{
        volume_id: string;
      }>;
      for (const { volume_id: volumeId } of volumes) {
        const scrapped = db
          .prepare(
            `SELECT id FROM chapters
             WHERE volume_id = ? AND status = 'scrapped'
             ORDER BY index_no`,
          )
          .all(volumeId) as Array<{ id: string }>;
        if (scrapped.length === 0) continue;

        // 先整体挪到临时区，避开两批目标序号交叉时中途撞车
        scrapped.forEach((row, position) => {
          db.prepare('UPDATE chapters SET index_no = ? WHERE id = ?').run(
            -(TEMP_BASE + position + 1),
            row.id,
          );
        });
        // 再落到保留区，与原位置无关，原位置另有 original_index_no 记录
        scrapped.forEach((row, position) => {
          db.prepare('UPDATE chapters SET index_no = ? WHERE id = ?').run(
            -(OFFSET + position + 1),
            row.id,
          );
        });
      }
    },
  },
  {
    version: 12,
    name: '封面拆出为小说目录下的图片文件',
    statements: [],
    run: (db) => {
      /*
       * 封面原先以 base64 整串存在 novels.cover_image 里，一行就能占掉几十万字节，
       * 而它本来就是一个图片文件。这里把它落成 data/novel/{id}/cover.png 并清空字段，
       * 之后小说目录自带封面，整部作品可以作为一个目录搬走。
       *
       * 读写文件属于存储层的职责，但迁移要能在任何阶段独立跑完，
       * 因此直接在这里写盘，不反向依赖仓储层。
       */
      const rows = db
        .prepare(`SELECT id, cover_image FROM novels WHERE cover_image LIKE 'data:%'`)
        .all() as Array<{ id: string; cover_image: string }>;
      if (rows.length === 0) return;

      let written = 0;
      for (const row of rows) {
        const match = /^data:([^;,]+);base64,(.*)$/su.exec(row.cover_image.trim());
        if (!match) continue;
        try {
          const dir = path.join(NOVEL_ROOT, row.id);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, 'cover.png'), Buffer.from(match[2] ?? '', 'base64'));
          written += 1;
        } catch (error) {
          // 单个封面写失败不该拦住整次迁移，字段保留以便下次重试
          console.warn(
            `[nymph] 封面迁移失败，已跳过：${row.id} ${
              error instanceof Error ? error.message : ''
            }`,
          );
        }
      }
      // 只清成功落盘的那些，失败的原样留着
      const placeholders = rows.map(() => '?').join(', ');
      db.prepare(`UPDATE novels SET cover_image = '' WHERE id IN (${placeholders})`).run(
        ...rows.map((row) => row.id),
      );
      console.log(`[nymph] 已把 ${written} 张封面从数据库拆出到小说目录`);
    },
  },
];
