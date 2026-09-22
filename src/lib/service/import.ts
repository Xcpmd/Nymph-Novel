import {
  findCharacterByAlias,
  createCharacter,
  createEncyclopediaEntry,
  createRelation,
  createTimelineEvent,
  listBranches,
} from '../repo/story';
import { ensureNovelSkeleton } from '../store/chapter-files';
import { getDb, now, transact } from '../db';
import { shortId } from '../crypto';
import { updateNovelPreferences, setNovelText, NOVEL_TEXT_KEYS, getNovelPreferences } from '../repo/settings';
import { buildRelPath } from '../store/chapter-files';
import { writeChapterContent } from '../store/chapter-files';
import { countWords } from '../token';
import { rebuildNovelIndex } from '../repo/novels';
import { getNovel } from '../repo/novels';
import type { ChapterStatus, CharacterRole, RelationKind } from '../types';

/**
 * 小说导入。
 * 支持结构化归档文件与纯文本两种来源。
 * 导入过程在事务内写入元数据，正文文件单独落盘后统一重建索引。
 */

export interface ImportedChapter {
  title: string;
  content: string;
  volumeTitle?: string;
  status?: ChapterStatus;
  /** 旧档案可能带有时间标注，导入时用于补齐时间轴 */
  timelineTime?: string;
}

export interface ImportDocument {
  title: string;
  author?: string;
  genre?: string;
  summary?: string;
  coverEmoji?: string;
  worldview?: string;
  setting?: string;
  outlineOverview?: string;
  calendar?: string;
  chapters: ImportedChapter[];
  characters?: Array<{
    name: string;
    aliases?: string[];
    roleType?: CharacterRole;
    gender?: string;
    age?: string;
    personality?: string;
    ability?: string;
    background?: string;
    emoji?: string;
    isPrimary?: boolean;
  }>;
  relations?: Array<{ from: string; to: string; kind?: RelationKind; label?: string; strength?: number }>;
  encyclopedia?: Array<{ category?: string; name: string; aliases?: string; summary?: string; content?: string }>;
}

/** 从纯文本中解析章节。识别 第X章 与 第X卷 标记。 */
export function parsePlainText(text: string): ImportedChapter[] {
  const lines = text.split(/\r?\n/);
  const chapters: ImportedChapter[] = [];
  const volumePattern = /^\s*(第[零一二三四五六七八九十百千万\d]+卷)[\s:：]*(.*)$/;
  const chapterPattern = /^\s*(第[零一二三四五六七八九十百千万\d]+[章节回])[\s:：]*(.*)$/;

  let current: ImportedChapter | null = null;
  let currentVolume = '';
  const buffer: string[] = [];

  const flush = () => {
    if (!current) return;
    current.content = buffer.join('\n').trim();
    chapters.push(current);
    buffer.length = 0;
    current = null;
  };

  for (const line of lines) {
    const volumeMatch = line.match(volumePattern);
    if (volumeMatch) {
      flush();
      currentVolume = `${volumeMatch[1]}${volumeMatch[2] ? ` ${volumeMatch[2].trim()}` : ''}`;
      continue;
    }
    const chapterMatch = line.match(chapterPattern);
    if (chapterMatch) {
      flush();
      const title = chapterMatch[2]?.trim();
      current = {
        title: title ? `${chapterMatch[1]} ${title}` : chapterMatch[1]!,
        content: '',
        volumeTitle: currentVolume || undefined,
      };
      continue;
    }
    if (current) buffer.push(line);
  }
  flush();

  if (chapters.length === 0 && text.trim()) {
    return [{ title: '第1章', content: text.trim() }];
  }
  return chapters;
}

/** 执行导入，返回新建小说的标识与统计。 */
export function importNovel(document: ImportDocument): {
  novelId: string;
  title: string;
  chapters: number;
  volumes: number;
} {
  const title = document.title?.trim() || '导入的小说';
  const novelId = shortId('nv');
  const timestamp = now();

  // 按卷标题分组，保持出现顺序
  const volumeOrder: string[] = [];
  const grouped = new Map<string, ImportedChapter[]>();
  for (const chapter of document.chapters) {
    const key = chapter.volumeTitle?.trim() || '第一卷';
    if (!grouped.has(key)) {
      grouped.set(key, []);
      volumeOrder.push(key);
    }
    grouped.get(key)!.push(chapter);
  }
  if (volumeOrder.length === 0) {
    volumeOrder.push('第一卷');
    grouped.set('第一卷', []);
  }

  const volumeIds: string[] = [];

  transact(() => {
    const db = getDb();
    db.prepare(
      `INSERT INTO novels (id, title, author, genre, summary, cover_emoji, status,
         word_count, chapter_count, volume_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'ongoing', 0, 0, 0, ?, ?)`,
    ).run(
      novelId,
      title,
      document.author?.trim() ?? '未知作者',
      document.genre?.trim() ?? '',
      document.summary?.trim() ?? '',
      document.coverEmoji ?? '📖',
      timestamp,
      timestamp,
    );

    volumeOrder.forEach((volumeTitle, volumeIndex) => {
      const volumeId = shortId('vol');
      volumeIds.push(volumeId);
      db.prepare(
        `INSERT INTO volumes (id, novel_id, index_no, title, summary, created_at, updated_at)
         VALUES (?, ?, ?, ?, '', ?, ?)`,
      ).run(volumeId, novelId, volumeIndex + 1, volumeTitle, timestamp, timestamp);
    });

    const mainBranchId = shortId('br');
    db.prepare(
      `INSERT INTO timeline_branches (id, novel_id, name, parent_branch_id, fork_event_id,
         merge_event_id, is_main, color, description, created_at, updated_at)
       VALUES (?, ?, '主线', NULL, NULL, NULL, 1, '', '故事主线时间轴', ?, ?)`,
    ).run(mainBranchId, novelId, timestamp, timestamp);

    // 元数据先落库，正文文件随后写入
    volumeOrder.forEach((volumeTitle, volumeIndex) => {
      const volumeId = volumeIds[volumeIndex]!;
      const list = grouped.get(volumeTitle) ?? [];
      list.forEach((chapter, position) => {
        const indexNo = position + 1;
        const relPath = buildRelPath(volumeIndex + 1, indexNo);
        const id = shortId('chp');
        db.prepare(
          `INSERT INTO chapters (id, novel_id, volume_id, index_no, title, rel_path, status,
             word_count, event_id, step_index, timeline_sort, branch_id, direction, notes,
             created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, '', ?, '', '', ?, ?)`,
        ).run(
          id,
          novelId,
          volumeId,
          indexNo,
          chapter.title,
          relPath,
          chapter.status ?? 'generated',
          countWords(chapter.content),
          mainBranchId,
          timestamp,
          timestamp,
        );
      });
    });

    ensureNovelSkeleton(novelId, 1);
  });

  // 正文文件落盘在事务之外，避免长时间持有写锁
  for (const [index, volumeTitle] of volumeOrder.entries()) {
    const list = grouped.get(volumeTitle) ?? [];
    for (const [position, chapter] of list.entries()) {
      writeChapterContent(novelId, buildRelPath(index + 1, position + 1), chapter.content);
    }
  }

  if (document.worldview) setNovelText(novelId, NOVEL_TEXT_KEYS.worldview, document.worldview);
  if (document.setting) setNovelText(novelId, NOVEL_TEXT_KEYS.setting, document.setting);
  if (document.outlineOverview) {
    setNovelText(novelId, NOVEL_TEXT_KEYS.outlineOverview, document.outlineOverview);
  }
  if (document.calendar || document.summary) {
    const preferences = getNovelPreferences(novelId);
    updateNovelPreferences(novelId, {
      calendar: document.calendar ?? preferences.calendar,
    });
  }

  for (const character of document.characters ?? []) {
    if (!character.name?.trim()) continue;
    createCharacter(novelId, {
      name: character.name.trim(),
      aliases: character.aliases ?? [],
      roleType: character.roleType ?? 'supporting',
      gender: character.gender ?? '',
      age: character.age ?? '',
      personality: character.personality ?? '',
      ability: character.ability ?? '',
      background: character.background ?? '',
      emoji: character.emoji ?? '🙂',
      isPrimary: character.isPrimary ?? false,
    });
  }

  for (const relation of document.relations ?? []) {
    const from = findCharacterByAlias(novelId, relation.from);
    const to = findCharacterByAlias(novelId, relation.to);
    if (!from || !to || from.id === to.id) continue;
    createRelation(novelId, {
      fromCharacterId: from.id,
      toCharacterId: to.id,
      kind: relation.kind ?? 'other',
      label: relation.label ?? '',
      strength: relation.strength ?? 3,
    });
  }

  for (const entry of document.encyclopedia ?? []) {
    if (!entry.name?.trim()) continue;
    createEncyclopediaEntry(novelId, {
      name: entry.name.trim(),
      category: entry.category ?? '其他',
      aliases: entry.aliases ?? '',
      summary: entry.summary ?? '',
      content: entry.content ?? '',
    });
  }

  // 依据章节元数据补齐时间轴事件，导入的旧档案可能带有时间标注
  const chapters = getDb()
    .prepare(
      `SELECT id, title, timeline_sort, branch_id, index_no
       FROM chapters WHERE novel_id = ? ORDER BY index_no`,
    )
    .all(novelId) as Array<{
    id: string;
    title: string;
    timeline_sort: string;
    branch_id: string | null;
    index_no: number;
  }>;
  const mainBranch = listBranches(novelId).find((branch) => branch.isMain);
  if (mainBranch) {
    for (const chapter of chapters) {
      if (!chapter.timeline_sort) continue;
      createTimelineEvent(novelId, {
        branchId: chapter.branch_id ?? mainBranch.id,
        chapterId: chapter.id,
        novelTime: chapter.timeline_sort,
        title: chapter.title,
        description: '',
        impact: '',
        orderNo: chapter.index_no,
      });
    }
  }

  rebuildNovelIndex(novelId);

  return {
    novelId,
    title,
    chapters: document.chapters.length,
    volumes: volumeOrder.length,
  };
}

/** 导入结果自检，便于界面提示。 */
export function describeImportedNovel(novelId: string): { title: string; chapters: number } | null {
  const novel = getNovel(novelId);
  if (!novel) return null;
  return { title: novel.title, chapters: novel.chapterCount };
}
