import { getDb, now, transact } from '../db';
import { shortId } from '../crypto';
import { normalizeContentRelPath, scrapChapterRelPath, volumeDirName } from '../paths';
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
  original_index_no?: number | null;
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
    originalIndexNo: row.original_index_no ?? null,
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

/**
 * 重新统计小说的字数、章节数与卷数。
 *
 * 废案章节不计入：它们已经退出正文，算进总数会让进度显示虚高。
 */
export function refreshNovelStats(novelId: string): Novel | null {
  const stats = getDb()
    .prepare(
      `SELECT COUNT(*) AS chapters, COALESCE(SUM(word_count), 0) AS words
       FROM chapters WHERE novel_id = ? AND status != 'scrapped'`,
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
  /** 是否把废案章节一并列出，默认不列出 */
  includeScrapped?: boolean;
  /** 只列出废案章节，供废案区使用 */
  onlyScrapped?: boolean;
}

/**
 * 列出某部小说的章节，按卷序号与章序号排列。
 *
 * 废案章节默认不出现在结果里。它们被排在独立的废案区，
 * 序号带负偏移，因此单独查询时要用反序才能还原成原本的先后顺序。
 */
export function listChapters(novelId: string, options: ListChapterOptions = {}): ChapterWithVolume[] {
  const params: unknown[] = [novelId];
  let where = 'WHERE c.novel_id = ?';

  if (options.onlyScrapped) {
    where += ' AND c.status = ?';
    params.push('scrapped');
  } else if (!options.includeScrapped) {
    where += ' AND c.status != ?';
    params.push('scrapped');
  }

  if (options.volumeId) {
    where += ' AND c.volume_id = ?';
    params.push(options.volumeId);
  }

  // 废案的序号是负偏移，取反后才是它原本的位置
  const order = options.onlyScrapped ? 'ORDER BY v.index_no, -c.index_no' : 'ORDER BY v.index_no, c.index_no';

  const rows = getDb()
    .prepare(
      `SELECT c.*, v.index_no AS volume_index, v.title AS volume_title
       FROM chapters c JOIN volumes v ON v.id = c.volume_id
       ${where}
       ${order}`,
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

/**
 * 批量调整章节文件的位置。
 *
 * 不能按顺序逐个改名：排在后面的章节常常正占着前面章节的目标路径，
 * 直接改过去会互相覆盖，在 Windows 上还会直接报错。
 * 因此先把所有要动的文件挪到临时名，再统一落到目标位置。
 *
 * 临时名以点开头并放在卷目录下，不会与章节目录混淆，
 * 万一中途失败也能一眼看出是残留的中间产物。
 */
function relocateChapterFiles(
  novelId: string,
  volumeIndex: number,
  moves: Array<{ from: string; to: string }>,
): void {
  const pending = moves.filter((move) => normalizeContentRelPath(move.from) !== move.to);
  if (pending.length === 0) return;

  const staged: Array<{ temp: string; to: string }> = [];
  pending.forEach((move, index) => {
    const temp = `${volumeDirName(volumeIndex)}/.staging-${index}.md`;
    moveChapterFile(novelId, move.from, temp);
    staged.push({ temp, to: move.to });
  });
  for (const item of staged) {
    moveChapterFile(novelId, item.temp, item.to);
  }
}

/**
 * 把章节移动到卷内的指定序号。
 *
 * 目标位置及其后的章节顺移一位。表上有 UNIQUE(volume_id, index_no)，
 * 因此不能直接改写序号，先把整卷章节挪到负数占位，再按新顺序写回正数。
 * 磁盘上的正文文件同步改名，否则序号与目录会对不上。
 */
export function moveChapterToIndex(
  chapterId: string,
  targetIndex: number,
): ChapterWithVolume | null {
  const chapter = getChapter(chapterId);
  if (!chapter) return null;
  const volume = getVolume(chapter.volumeId);
  if (!volume) return null;

  const rows = getDb()
    .prepare('SELECT id, index_no, rel_path FROM chapters WHERE volume_id = ? ORDER BY index_no')
    .all(chapter.volumeId) as Array<{ id: string; index_no: number; rel_path: string }>;

  const others = rows.filter((row) => row.id !== chapterId);
  // 目标序号夹在合法范围内，越界时贴到两端
  const position = Math.max(1, Math.min(targetIndex, others.length + 1));
  const ordered = [...others];
  ordered.splice(position - 1, 0, {
    id: chapterId,
    index_no: chapter.indexNo,
    rel_path: chapter.relPath,
  });

  transact(() => {
    // 先全部落到负数，避开唯一约束
    ordered.forEach((row, index) => {
      getDb().prepare('UPDATE chapters SET index_no = ? WHERE id = ?').run(-(index + 1), row.id);
    });
    ordered.forEach((row, index) => {
      getDb()
        .prepare('UPDATE chapters SET index_no = ?, rel_path = ?, updated_at = ? WHERE id = ?')
        .run(index + 1, buildRelPath(volume.indexNo, index + 1), now(), row.id);
    });
  });

  // 文件移动放在事务之外，避免拖长写锁
  relocateChapterFiles(
    volume.novelId,
    volume.indexNo,
    ordered.map((row, index) => ({
      from: row.rel_path,
      to: buildRelPath(volume.indexNo, index + 1),
    })),
  );

  refreshNovelStats(chapter.novelId);
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

/* ------------------------------------------------------- 章节废案与还原 */

/**
 * 废案章节在序号上的偏移量。
 *
 * 表上有 UNIQUE(volume_id, index_no) 约束，而废案章节仍需留在原卷里等用户决定去留，
 * 因此把序号翻到负数区间腾出位置。偏移量取得足够大，
 * 与重编号时用的小负数占位（-1 起步）互不干扰。
 */
export const SCRAPPED_INDEX_OFFSET = 100000;

/** 编号是否为废案章节所用。 */
export function isScrappedIndex(indexNo: number): boolean {
  return indexNo <= -SCRAPPED_INDEX_OFFSET;
}

/** 由废案序号还原出它原本的位置。 */
function originalIndex(indexNo: number): number {
  return -indexNo - SCRAPPED_INDEX_OFFSET;
}

/**
 * 为废章找一个未被占用的负序号。
 *
 * 直接用「偏移量加原序号」会撞车：同一卷里若有两个章节先后从同一位置被废，
 * 算出的负数完全相同。这里在原序号的基础上继续往下找，直到没有冲突为止。
 * 原位置因此不再编码在序号里，改由 original_index_no 单独记录。
 */
function nextScrappedIndex(volumeId: string, baseIndex: number): number {
  const used = new Set(
    (
      getDb()
        .prepare('SELECT index_no FROM chapters WHERE volume_id = ?')
        .all(volumeId) as Array<{ index_no: number }>
    ).map((row) => row.index_no),
  );
  let candidate = -(SCRAPPED_INDEX_OFFSET + baseIndex);
  while (used.has(candidate)) candidate -= 1;
  return candidate;
}

/**
 * 把一个章节设为废案。
 *
 * 记录与正文都保留，只是移出正常目录并让出序号。
 * 正文一并挪到独立的废案目录：留在原位的话，后续章节重编号
 * 会把文件搬到废案正占着的路径上，两边撞车导致改名失败。
 */
export function scrapChapter(chapterId: string): ChapterWithVolume | null {
  const chapter = getChapter(chapterId);
  if (!chapter || chapter.status === 'scrapped') return chapter;

  const targetRel = scrapChapterRelPath(chapterId);
  moveChapterFile(chapter.novelId, chapter.relPath, targetRel);

  getDb()
    .prepare(
      `UPDATE chapters
       SET status = 'scrapped', index_no = ?, original_index_no = ?, rel_path = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      nextScrappedIndex(chapter.volumeId, chapter.indexNo),
      chapter.indexNo,
      targetRel,
      now(),
      chapterId,
    );

  // 腾出的位置由后续章节依次补上
  renumberChapters(chapter.volumeId);
  refreshNovelStats(chapter.novelId);
  return getChapter(chapterId);
}

/** 还原废案的结果。失败时给出原因与占位章节名，供界面提示。 */
export type RestoreChapterResult =
  | { ok: true; chapter: ChapterWithVolume }
  | {
      ok: false;
      reason: 'notFound' | 'notScrapped' | 'occupied';
      chapter: ChapterWithVolume | null;
      occupiedTitle?: string;
    };

/**
 * 把废案章节还原回正常目录。
 *
 * 原本的位置此时可能已被别的章节占用。这种情况不自动挤走对方，
 * 而是让调用方先去把那章设为废案，避免悄悄改动用户没打算动的章节。
 */
export function restoreChapter(chapterId: string): RestoreChapterResult {
  const chapter = getChapter(chapterId);
  if (!chapter) return { ok: false, reason: 'notFound', chapter: null };
  if (chapter.status !== 'scrapped') return { ok: false, reason: 'notScrapped', chapter };

  // 原位置由专用字段记录，读不到时退回早期版本编码在序号里的写法
  const target = chapter.originalIndexNo ?? originalIndex(chapter.indexNo);
  const occupied = getDb()
    .prepare('SELECT title FROM chapters WHERE volume_id = ? AND index_no = ?')
    .get(chapter.volumeId, target) as { title: string } | undefined;

  if (occupied) {
    return { ok: false, reason: 'occupied', chapter, occupiedTitle: occupied.title };
  }

  // 状态按内容还原：有正文的回到已生成，空章回到待写
  const restored: ChapterStatus = chapter.wordCount > 0 ? 'generated' : 'planned';
  const targetRel = buildRelPath(chapter.volumeIndex, target);
  moveChapterFile(chapter.novelId, chapter.relPath, targetRel);

  getDb()
    .prepare(
      `UPDATE chapters
       SET status = ?, index_no = ?, original_index_no = NULL, rel_path = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(restored, target, targetRel, now(), chapterId);

  refreshNovelStats(chapter.novelId);
  return { ok: true, chapter: getChapter(chapterId)! };
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

/**
 * 重排某一卷内章节序号，并同步移动正文文件。
 *
 * 废案章节不参与重排：它们已经移出正常序列，序号是负偏移，
 * 若一并重排会把它们拉回正数区间，与正常章节抢号。
 */
export function renumberChapters(volumeId: string): void {
  const volume = getVolume(volumeId);
  if (!volume) return;

  const rows = getDb()
    .prepare(
      `SELECT id, index_no, rel_path FROM chapters
       WHERE volume_id = ? AND status != 'scrapped'
       ORDER BY index_no`,
    )
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
  relocateChapterFiles(
    volume.novelId,
    volume.indexNo,
    rows.map((row, position) => ({
      from: row.rel_path,
      to: buildRelPath(volume.indexNo, position + 1),
    })),
  );
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
