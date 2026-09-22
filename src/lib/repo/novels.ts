import { getDb, now, transact } from '../db';
import { shortId } from '../crypto';
import { normalizeContentRelPath } from '../paths';
import {
  buildRelPath,
  deleteChapterFile,
  deleteNovelFiles,
  ensureNovelSkeleton,
  moveChapterFile,
  readChapterContent,
  writeChapterContent,
} from '../store/chapter-files';
import { ensureSetupDir } from '../store/setup-files';
import type {
  Chapter,
  ChapterStatus,
  ChapterWithVolume,
  CoverFit,
  CreateChapterInput,
  Novel,
  NovelStatus,
  Volume,
} from '../types';

interface NovelRow {
  id: string;
  title: string;
  author: string;
  genre: string;
  summary: string;
  cover_emoji: string;
  cover_image: string;
  cover_fit: string;
  status: string;
  word_count: number;
  chapter_count: number;
  volume_count: number;
  created_at: string;
  updated_at: string;
}

interface VolumeRow {
  id: string;
  novel_id: string;
  index_no: number;
  title: string;
  summary: string;
  created_at: string;
  updated_at: string;
  chapter_count?: number;
  word_count?: number;
}

interface ChapterRow {
  id: string;
  novel_id: string;
  volume_id: string;
  index_no: number;
  title: string;
  rel_path: string;
  status: string;
  word_count: number;
  event_id: string | null;
  step_index: number | null;
  timeline_sort: string;
  branch_id: string | null;
  direction: string;
  notes: string;
  created_at: string;
  updated_at: string;
  volume_index?: number;
  volume_title?: string;
}

function mapNovel(row: NovelRow): Novel {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    genre: row.genre,
    summary: row.summary,
    coverEmoji: row.cover_emoji,
    coverImage: row.cover_image ?? '',
    coverFit: (row.cover_fit ?? 'cover') as CoverFit,
    status: row.status as NovelStatus,
    wordCount: row.word_count,
    chapterCount: row.chapter_count,
    volumeCount: row.volume_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapVolume(row: VolumeRow): Volume {
  return {
    id: row.id,
    novelId: row.novel_id,
    indexNo: row.index_no,
    title: row.title,
    summary: row.summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    chapterCount: row.chapter_count,
    wordCount: row.word_count,
  };
}

function mapChapter(row: ChapterRow): Chapter {
  return {
    id: row.id,
    novelId: row.novel_id,
    volumeId: row.volume_id,
    indexNo: row.index_no,
    title: row.title,
    // 早期版本把正文路径写成 卷-001/章-001/正文.md 这样的中文形式，
    // 这里统一归一为拉丁写法，上层不必关心库里存的是哪一套命名。
    relPath: normalizeContentRelPath(row.rel_path),
    status: row.status as ChapterStatus,
    wordCount: row.word_count,
    eventId: row.event_id ?? null,
    stepIndex: row.step_index ?? null,
    timelineSort: row.timeline_sort,
    branchId: row.branch_id,
    direction: row.direction,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapChapterWithVolume(row: ChapterRow): ChapterWithVolume {
  return {
    ...mapChapter(row),
    volumeIndex: row.volume_index ?? 0,
    volumeTitle: row.volume_title ?? '',
  };
}

/* ------------------------------------------------------------------ 小说 */

/** 列出全部小说，最近更新的排在前面。 */
export function listNovels(): Novel[] {
  const rows = getDb()
    .prepare('SELECT * FROM novels ORDER BY updated_at DESC')
    .all() as NovelRow[];
  return rows.map(mapNovel);
}

/** 读取单部小说。 */
export function getNovel(novelId: string): Novel | null {
  const row = getDb().prepare('SELECT * FROM novels WHERE id = ?').get(novelId) as
    | NovelRow
    | undefined;
  return row ? mapNovel(row) : null;
}

export interface CreateNovelInput {
  title: string;
  author?: string;
  genre?: string;
  summary?: string;
  coverEmoji?: string;
  coverImage?: string;
}

/** 新建小说，同时落库、创建文件目录与首卷。 */
export function createNovel(input: CreateNovelInput): Novel {
  const id = shortId('nv');
  const timestamp = now();
  transact(() => {
    getDb()
      .prepare(
        `INSERT INTO novels (id, title, author, genre, summary, cover_emoji, cover_image, cover_fit,
           status, word_count, chapter_count, volume_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'cover', 'drafting', 0, 0, 0, ?, ?)`,
      )
      .run(
        id,
        input.title.trim() || '未命名小说',
        input.author?.trim() ?? '',
        input.genre?.trim() ?? '',
        input.summary?.trim() ?? '',
        input.coverEmoji ?? '📖',
        input.coverImage ?? '',
        timestamp,
        timestamp,
      );

    const volumeId = shortId('vol');
    getDb()
      .prepare(
        `INSERT INTO volumes (id, novel_id, index_no, title, summary, created_at, updated_at)
         VALUES (?, ?, 1, ?, '', ?, ?)`,
      )
      .run(volumeId, id, '第一卷', timestamp, timestamp);

    // 时间轴主线：每部小说必然存在，AI 更新事件时默认写入这条线
    const branchId = shortId('br');
    getDb()
      .prepare(
        `INSERT INTO timeline_branches (id, novel_id, name, parent_branch_id, fork_event_id,
           merge_event_id, is_main, color, description, created_at, updated_at)
         VALUES (?, ?, '主线', NULL, NULL, NULL, 1, '', '故事主线时间轴', ?, ?)`,
      )
      .run(branchId, id, timestamp, timestamp);
  });

  ensureNovelSkeleton(id, 1);
  ensureSetupDir(id);
  return getNovel(id)!;
}

/** 更新小说的基础信息。 */
export function updateNovel(novelId: string, patch: Partial<Novel>): Novel | null {
  const fields: string[] = [];
  const values: unknown[] = [];
  const assign = (column: string, value: unknown) => {
    fields.push(`${column} = ?`);
    values.push(value);
  };

  if (patch.title !== undefined) assign('title', patch.title.trim() || '未命名小说');
  if (patch.author !== undefined) assign('author', patch.author);
  if (patch.genre !== undefined) assign('genre', patch.genre);
  if (patch.summary !== undefined) assign('summary', patch.summary);
  if (patch.coverEmoji !== undefined) assign('cover_emoji', patch.coverEmoji);
  if (patch.coverImage !== undefined) assign('cover_image', patch.coverImage);
  if (patch.coverFit !== undefined) assign('cover_fit', patch.coverFit);
  if (patch.status !== undefined) assign('status', patch.status);

  if (fields.length > 0) {
    assign('updated_at', now());
    getDb()
      .prepare(`UPDATE novels SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values, novelId);
  }
  return getNovel(novelId);
}

/** 删除小说，一并清除正文目录与全部关联数据。 */
export function deleteNovel(novelId: string): void {
  transact(() => {
    getDb().prepare('DELETE FROM chapter_fts WHERE novel_id = ?').run(novelId);
    getDb().prepare('DELETE FROM novels WHERE id = ?').run(novelId);
  });
  deleteNovelFiles(novelId);
}

/** 重新统计小说的字数、章节数与卷数。 */
export function refreshNovelStats(novelId: string): Novel | null {
  const stats = getDb()
    .prepare(
      `SELECT COUNT(*) AS chapters, COALESCE(SUM(word_count), 0) AS words
       FROM chapters WHERE novel_id = ?`,
    )
    .get(novelId) as { chapters: number; words: number };
  const volumes = getDb()
    .prepare('SELECT COUNT(*) AS count FROM volumes WHERE novel_id = ?')
    .get(novelId) as { count: number };

  getDb()
    .prepare(
      `UPDATE novels SET chapter_count = ?, word_count = ?, volume_count = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(stats.chapters, stats.words, volumes.count, now(), novelId);
  return getNovel(novelId);
}

/* -------------------------------------------------------------------- 卷 */

/** 列出某部小说的全部卷，附带章节数与字数。 */
export function listVolumes(novelId: string): Volume[] {
  const rows = getDb()
    .prepare(
      `SELECT v.*,
              (SELECT COUNT(*) FROM chapters c WHERE c.volume_id = v.id) AS chapter_count,
              (SELECT COALESCE(SUM(word_count), 0) FROM chapters c WHERE c.volume_id = v.id) AS word_count
       FROM volumes v WHERE v.novel_id = ? ORDER BY v.index_no`,
    )
    .all(novelId) as VolumeRow[];
  return rows.map(mapVolume);
}

/** 读取单卷。 */
export function getVolume(volumeId: string): Volume | null {
  const row = getDb().prepare('SELECT * FROM volumes WHERE id = ?').get(volumeId) as
    | VolumeRow
    | undefined;
  return row ? mapVolume(row) : null;
}

/** 新建一卷，追加在末尾。只有在超大型事件结束时才应当调用。 */
export function createVolume(novelId: string, title?: string): Volume {
  const max = getDb()
    .prepare('SELECT COALESCE(MAX(index_no), 0) AS maxIndex FROM volumes WHERE novel_id = ?')
    .get(novelId) as { maxIndex: number };
  const indexNo = max.maxIndex + 1;
  const id = shortId('vol');
  const timestamp = now();
  getDb()
    .prepare(
      `INSERT INTO volumes (id, novel_id, index_no, title, summary, created_at, updated_at)
       VALUES (?, ?, ?, ?, '', ?, ?)`,
    )
    .run(id, novelId, indexNo, title?.trim() || `第${indexNo}卷`, timestamp, timestamp);

  ensureNovelSkeleton(novelId, indexNo);
  refreshNovelStats(novelId);
  return getVolume(id)!;
}

/** 更新卷信息。 */
export function updateVolume(volumeId: string, patch: Partial<Volume>): Volume | null {
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.title !== undefined) {
    fields.push('title = ?');
    values.push(patch.title);
  }
  if (patch.summary !== undefined) {
    fields.push('summary = ?');
    values.push(patch.summary);
  }
  if (fields.length > 0) {
    fields.push('updated_at = ?');
    values.push(now(), volumeId);
    getDb()
      .prepare(`UPDATE volumes SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);
  }
  return getVolume(volumeId);
}

/** 删除一卷及其全部章节与正文文件。 */
export function deleteVolume(volumeId: string): void {
  const volume = getVolume(volumeId);
  if (!volume) return;
  const chapters = listChapters(volume.novelId, { volumeId });
  transact(() => {
    for (const chapter of chapters) {
      getDb().prepare('DELETE FROM chapter_fts WHERE chapter_id = ?').run(chapter.id);
    }
    getDb().prepare('DELETE FROM volumes WHERE id = ?').run(volumeId);
  });
  for (const chapter of chapters) {
    deleteChapterFile(volume.novelId, chapter.relPath);
  }
  renumberVolumes(volume.novelId);
  refreshNovelStats(volume.novelId);
}

/** 重排卷序号，使序号连续，并同步章节文件目录。 */
export function renumberVolumes(novelId: string): void {
  const volumes = getDb()
    .prepare('SELECT id, index_no FROM volumes WHERE novel_id = ? ORDER BY index_no')
    .all(novelId) as Array<{ id: string; index_no: number }>;

  transact(() => {
    // 先移到负数区避免唯一约束冲突
    const offset = getDb().prepare('UPDATE volumes SET index_no = ? WHERE id = ?');
    volumes.forEach((volume, position) => offset.run(-(position + 1), volume.id));
    volumes.forEach((volume, position) => offset.run(position + 1, volume.id));
  });

  // 卷序号变化后，其下章节的物理路径也需要跟随
  const updated = getDb()
    .prepare('SELECT id FROM volumes WHERE novel_id = ? ORDER BY index_no')
    .all(novelId) as Array<{ id: string }>;
  for (const volume of updated) {
    renumberChapters(volume.id);
  }
}

/* -------------------------------------------------------------------- 章 */

export interface ListChapterOptions {
  volumeId?: string;
  withContent?: boolean;
}

/** 列出某部小说的全部章节，按卷序号与章序号排列。 */
export function listChapters(novelId: string, options: ListChapterOptions = {}): ChapterWithVolume[] {
  const params: unknown[] = [novelId];
  let where = 'WHERE c.novel_id = ?';
  if (options.volumeId) {
    where += ' AND c.volume_id = ?';
    params.push(options.volumeId);
  }
  const rows = getDb()
    .prepare(
      `SELECT c.*, v.index_no AS volume_index, v.title AS volume_title
       FROM chapters c JOIN volumes v ON v.id = c.volume_id
       ${where}
       ORDER BY v.index_no, c.index_no`,
    )
    .all(...params) as ChapterRow[];
  return rows.map(mapChapterWithVolume);
}

/** 读取单个章节。 */
export function getChapter(chapterId: string): ChapterWithVolume | null {
  const row = getDb()
    .prepare(
      `SELECT c.*, v.index_no AS volume_index, v.title AS volume_title
       FROM chapters c JOIN volumes v ON v.id = c.volume_id WHERE c.id = ?`,
    )
    .get(chapterId) as ChapterRow | undefined;
  return row ? mapChapterWithVolume(row) : null;
}

/**
 * 新建章节。
 * 默认追加到指定卷末尾；指定 index 时插入到该位置并把后续章节顺延。
 */
export function createChapter(novelId: string, input: CreateChapterInput): ChapterWithVolume {
  const timestamp = now();

  const requestedVolume = input.volumeId ? getVolume(input.volumeId) : null;
  const volume =
    requestedVolume ??
    (() => {
      const volumes = listVolumes(novelId);
      if (volumes.length > 0) return volumes[volumes.length - 1]!;
      return createVolume(novelId);
    })();

  const existing = listChapters(novelId, { volumeId: volume.id });
  const insertAt = input.index && input.index > 0 ? Math.min(input.index, existing.length + 1) : existing.length + 1;

  // 先把插入点之后的章节整体后移一位，腾出位置
  if (insertAt <= existing.length) {
    transact(() => {
      for (let i = existing.length; i >= insertAt; i -= 1) {
        const chapter = existing[i - 1]!;
        getDb()
          .prepare('UPDATE chapters SET index_no = ? WHERE id = ?')
          .run(chapter.indexNo + 1000, chapter.id);
      }
    });
  }

  const id = shortId('chp');
  const relPath = buildRelPath(volume.indexNo, insertAt);
  const title = input.title.trim() || `第${insertAt}章`;

  getDb()
    .prepare(
      `INSERT INTO chapters (id, novel_id, volume_id, index_no, title, rel_path, status,
         word_count, event_id, step_index, timeline_sort, branch_id, direction, notes,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'planned', 0, ?, ?, '', NULL, ?, '', ?, ?)`,
    )
    .run(
      id,
      novelId,
      volume.id,
      insertAt,
      title,
      relPath,
      input.eventId ?? null,
      input.stepIndex ?? null,
      input.direction ?? '',
      timestamp,
      timestamp,
    );

  writeChapterContent(novelId, relPath, '');
  renumberChapters(volume.id);

  if (input.outlineNodeId) {
    getDb()
      .prepare('UPDATE outline_nodes SET chapter_id = ?, updated_at = ? WHERE id = ?')
      .run(id, timestamp, input.outlineNodeId);
  }

  refreshNovelStats(novelId);
  return getChapter(id)!;
}

/** 更新章节元数据。 */
export function updateChapter(chapterId: string, patch: Partial<Chapter>): ChapterWithVolume | null {
  const fields: string[] = [];
  const values: unknown[] = [];
  const assign = (column: string, value: unknown) => {
    fields.push(`${column} = ?`);
    values.push(value);
  };

  if (patch.title !== undefined) assign('title', patch.title);
  if (patch.status !== undefined) assign('status', patch.status);
  if (patch.eventId !== undefined) assign('event_id', patch.eventId);
  if (patch.stepIndex !== undefined) assign('step_index', patch.stepIndex);
  if (patch.timelineSort !== undefined) assign('timeline_sort', patch.timelineSort);
  if (patch.branchId !== undefined) assign('branch_id', patch.branchId);
  if (patch.direction !== undefined) assign('direction', patch.direction);
  if (patch.notes !== undefined) assign('notes', patch.notes);
  if (patch.wordCount !== undefined) assign('word_count', patch.wordCount);

  if (fields.length > 0) {
    assign('updated_at', now());
    getDb()
      .prepare(`UPDATE chapters SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values, chapterId);
  }
  return getChapter(chapterId);
}

/** 读取章节正文，同时把磁盘实际字数回写到数据库。 */
export function getChapterContent(chapterId: string): { chapter: ChapterWithVolume; content: string } {
  const chapter = getChapter(chapterId);
  if (!chapter) throw new Error('章节不存在');
  const file = readChapterContent(chapter.novelId, chapter.relPath);
  if (file.wordCount !== chapter.wordCount) {
    getDb()
      .prepare('UPDATE chapters SET word_count = ? WHERE id = ?')
      .run(file.wordCount, chapter.id);
    chapter.wordCount = file.wordCount;
    refreshNovelStats(chapter.novelId);
  }
  return { chapter, content: file.content };
}

/** 保存章节正文，同步字数、全文索引与所属小说统计。 */
export function saveChapterContent(
  chapterId: string,
  content: string,
  options: { markGenerated?: boolean } = {},
): ChapterWithVolume | null {
  const chapter = getChapter(chapterId);
  if (!chapter) return null;

  const file = writeChapterContent(chapter.novelId, chapter.relPath, content);
  getDb()
    .prepare(
      `UPDATE chapters SET word_count = ?, updated_at = ?
       ${options.markGenerated ? ", status = CASE WHEN status = 'revised' THEN 'revised' ELSE 'generated' END" : ''}
       WHERE id = ?`,
    )
    .run(file.wordCount, now(), chapterId);

  reindexChapter(chapterId, content, chapter.title);
  refreshNovelStats(chapter.novelId);
  return getChapter(chapterId);
}

/** 删除章节及其正文文件。 */
export function deleteChapter(chapterId: string): void {
  const chapter = getChapter(chapterId);
  if (!chapter) return;
  transact(() => {
    getDb().prepare('DELETE FROM chapter_fts WHERE chapter_id = ?').run(chapterId);
    getDb().prepare('DELETE FROM chapters WHERE id = ?').run(chapterId);
  });
  deleteChapterFile(chapter.novelId, chapter.relPath);
  renumberChapters(chapter.volumeId);
  refreshNovelStats(chapter.novelId);
}

/** 重排某一卷内章节序号，并同步移动正文文件。 */
export function renumberChapters(volumeId: string): void {
  const volume = getVolume(volumeId);
  if (!volume) return;

  const rows = getDb()
    .prepare('SELECT id, index_no, rel_path FROM chapters WHERE volume_id = ? ORDER BY index_no')
    .all(volumeId) as Array<{ id: string; index_no: number; rel_path: string }>;

  transact(() => {
    // 先用负序号占位，避开 UNIQUE(volume_id, index_no)
    rows.forEach((row, position) => {
      getDb()
        .prepare('UPDATE chapters SET index_no = ? WHERE id = ?')
        .run(-(position + 1), row.id);
    });
    rows.forEach((row, position) => {
      getDb()
        .prepare('UPDATE chapters SET index_no = ?, rel_path = ? WHERE id = ?')
        .run(position + 1, buildRelPath(volume.indexNo, position + 1), row.id);
    });
  });

  // 文件移动放在事务之外，避免拖长写锁占用
  rows.forEach((row, position) => {
    const target = buildRelPath(volume.indexNo, position + 1);
    // 库中可能还留着早期的中文路径，先归一再比对，避免误判为需要移动
    if (target !== normalizeContentRelPath(row.rel_path)) {
      moveChapterFile(volume.novelId, row.rel_path, target);
    }
  });
}

/** 全文索引重建。 */
export function reindexChapter(chapterId: string, content: string, title: string): void {
  const db = getDb();
  const chapter = getChapter(chapterId);
  if (!chapter) return;
  db.prepare('DELETE FROM chapter_fts WHERE chapter_id = ?').run(chapterId);
  db.prepare(
    'INSERT INTO chapter_fts (chapter_id, novel_id, title, content) VALUES (?, ?, ?, ?)',
  ).run(chapterId, chapter.novelId, title, content);
}

/** 重建整部小说的全文索引，用于导入后或数据修复。 */
export function rebuildNovelIndex(novelId: string): number {
  const db = getDb();
  const chapters = listChapters(novelId);
  const remove = db.prepare('DELETE FROM chapter_fts WHERE chapter_id = ?');
  const insert = db.prepare(
    'INSERT INTO chapter_fts (chapter_id, novel_id, title, content) VALUES (?, ?, ?, ?)',
  );
  const run = db.transaction(() => {
    for (const chapter of chapters) {
      const file = readChapterContent(novelId, chapter.relPath);
      remove.run(chapter.id);
      insert.run(chapter.id, novelId, chapter.title, file.content);
      db.prepare('UPDATE chapters SET word_count = ? WHERE id = ?').run(file.wordCount, chapter.id);
    }
  });
  run();
  refreshNovelStats(novelId);
  return chapters.length;
}

/** 汇总小说全部正文，用于导出与全局统计。 */
export function getNovelPlainText(novelId: string): string {
  const volumes = listVolumes(novelId);
  const parts: string[] = [];
  for (const volume of volumes) {
    parts.push(`\n\n${volume.title}\n`);
    for (const chapter of listChapters(novelId, { volumeId: volume.id })) {
      parts.push(`\n${chapter.title}\n\n`);
      parts.push(readChapterContent(novelId, chapter.relPath).content);
    }
  }
  return parts.join('\n');
}

/** 关键词搜索章节正文与标题，FTS 不可用时退化为 LIKE 查询。 */
export function searchChapters(novelId: string, keyword: string, limit = 40): Array<{
  chapterId: string;
  title: string;
  volumeIndex: number;
  chapterIndex: number;
  volumeTitle: string;
  snippet: string;
  score: number;
  matchedIn: 'title' | 'content' | 'both';
}> {
  const trimmed = keyword.trim();
  if (!trimmed) return [];
  const db = getDb();

  const decorate = (
    rows: Array<{
      chapter_id: string;
      title: string;
      content: string;
      volume_index: number;
      index_no: number;
      volume_title: string;
    }>,
  ) =>
    rows.map((row) => {
      const index = row.content.indexOf(trimmed);
      const start = Math.max(0, index - 60);
      const snippet =
        index >= 0
          ? `${start > 0 ? '…' : ''}${row.content.slice(start, index + trimmed.length + 90)}…`
          : row.content.slice(0, 140);
      const inTitle = row.title.includes(trimmed);
      const inContent = index >= 0;
      return {
        chapterId: row.chapter_id,
        title: row.title,
        volumeIndex: row.volume_index,
        chapterIndex: row.index_no,
        volumeTitle: row.volume_title,
        snippet: snippet.replace(/\n+/g, ' '),
        score: (inTitle ? 4 : 0) + (inContent ? 2 : 0),
        matchedIn: (inTitle && inContent ? 'both' : inTitle ? 'title' : 'content') as
          | 'title'
          | 'content'
          | 'both',
      };
    });

  try {
    // 用双引号包裹关键词，避免 FTS5 把特殊字符当作查询语法
    const escaped = trimmed.replace(/"/g, '""');
    const rows = db
      .prepare(
        `SELECT f.chapter_id, f.title, f.content, v.index_no AS volume_index,
                c.index_no, v.title AS volume_title
         FROM chapter_fts f
         JOIN chapters c ON c.id = f.chapter_id
         JOIN volumes v ON v.id = c.volume_id
         WHERE chapter_fts MATCH ? AND f.novel_id = ?
         LIMIT ?`,
      )
      .all(`"${escaped}"`, novelId, limit) as Array<{
      chapter_id: string;
      title: string;
      content: string;
      volume_index: number;
      index_no: number;
      volume_title: string;
    }>;
    if (rows.length > 0) {
      return decorate(rows).sort((a, b) => b.score - a.score);
    }
  } catch {
    // trigram 索引对过短关键词可能无结果，落到 LIKE 分支
  }

  const like = `%${trimmed}%`;
  const rows = db
    .prepare(
      `SELECT f.chapter_id, f.title, f.content, v.index_no AS volume_index,
              c.index_no, v.title AS volume_title
       FROM chapter_fts f
       JOIN chapters c ON c.id = f.chapter_id
       JOIN volumes v ON v.id = c.volume_id
       WHERE f.novel_id = ? AND (f.title LIKE ? OR f.content LIKE ?)
       LIMIT ?`,
    )
    .all(novelId, like, like, limit) as Array<{
    chapter_id: string;
    title: string;
    content: string;
    volume_index: number;
    index_no: number;
    volume_title: string;
  }>;
  return decorate(rows).sort((a, b) => b.score - a.score);
}

/* ------------------------------------------------------------------ 导出 */

export { mapChapter, mapNovel, mapVolume };
export type { ChapterRow, NovelRow, VolumeRow };
