import { getNovel, listChapters, listVolumes } from '../repo/novels';
import { readChapterContent } from '../store/chapter-files';
import {
  listBranches,
  listCharacters,
  listEncyclopedia,
  listOutlineNodes,
  listRelations,
  listStoryEvents,
  listTimelineEvents,
} from '../repo/story';
import { getNovelPreferences, readNovelText, NOVEL_TEXT_KEYS } from '../repo/settings';
import { sanitizeFileName } from '../paths';

/**
 * 小说导出。
 * 三种形态：标准 txt 小说文件、完整 Markdown 归档、结构化 JSON 归档。
 */

export type ExportFormat = 'txt' | 'md' | 'json';

export interface ExportResult {
  fileName: string;
  contentType: string;
  content: string;
}

function volumeHeading(index: number, title: string): string {
  return `第${index}卷 ${title.replace(/^第[零一二三四五六七八九十百千万\d]+卷\s*/, '')}`.trim();
}

/** 标准 txt 小说文件：按卷与章顺序组织，包含章节标题与正文。 */
export function exportAsTxt(novelId: string): ExportResult {
  const novel = getNovel(novelId);
  if (!novel) throw new Error('小说不存在');

  const lines: string[] = [];
  lines.push(novel.title);
  if (novel.author) lines.push(`作者：${novel.author}`);
  lines.push('');

  const volumes = listVolumes(novelId);
  for (const volume of volumes) {
    if (volumes.length > 1) {
      lines.push('');
      lines.push(volumeHeading(volume.indexNo, volume.title));
      lines.push('');
    }
    const chapters = listChapters(novelId, { volumeId: volume.id });
    for (const chapter of chapters) {
      lines.push(chapter.title);
      lines.push('');
      const content = readChapterContent(novelId, chapter.relPath).content.trim();
      lines.push(content);
      lines.push('');
      lines.push('');
    }
  }

  return {
    fileName: `${sanitizeFileName(novel.title)}.txt`,
    contentType: 'text/plain; charset=utf-8',
    content: lines.join('\n').replace(/\n{4,}/g, '\n\n\n'),
  };
}

/** Markdown 归档：带目录与分级标题，便于放入其他编辑器。 */
export function exportAsMarkdown(novelId: string): ExportResult {
  const novel = getNovel(novelId);
  if (!novel) throw new Error('小说不存在');

  const volumes = listVolumes(novelId);
  const parts: string[] = [`# ${novel.title}`, ''];
  if (novel.author) parts.push(`作者：${novel.author}`, '');
  if (novel.summary) parts.push('## 简介', '', novel.summary, '');

  parts.push('## 目录', '');
  for (const volume of volumes) {
    if (volumes.length > 1) parts.push(`- ${volumeHeading(volume.indexNo, volume.title)}`);
    for (const chapter of listChapters(novelId, { volumeId: volume.id })) {
      parts.push(`  - ${chapter.title}`);
    }
  }
  parts.push('');

  for (const volume of volumes) {
    if (volumes.length > 1) parts.push(`## ${volumeHeading(volume.indexNo, volume.title)}`, '');
    for (const chapter of listChapters(novelId, { volumeId: volume.id })) {
      parts.push(`### ${chapter.title}`, '');
      const content = readChapterContent(novelId, chapter.relPath).content.trim();
      parts.push(content.length > 0 ? content : '本章尚未生成正文。', '');
    }
  }

  return {
    fileName: `${sanitizeFileName(novel.title)}.md`,
    contentType: 'text/markdown; charset=utf-8',
    content: parts.join('\n'),
  };
}

/** 结构化归档：包含全部元数据与正文，可被导入功能完整还原。 */
export function exportAsJson(novelId: string): ExportResult {
  const novel = getNovel(novelId);
  if (!novel) throw new Error('小说不存在');

  const volumes = listVolumes(novelId).map((volume) => ({
    index: volume.indexNo,
    title: volume.title,
    summary: volume.summary,
    chapters: listChapters(novelId, { volumeId: volume.id }).map((chapter) => ({
      index: chapter.indexNo,
      title: chapter.title,
      content: readChapterContent(novelId, chapter.relPath).content,
      status: chapter.status,
      timelineTime: chapter.timelineSort,
      eventId: chapter.eventId,
      stepIndex: chapter.stepIndex,
    })),
  }));

  const payload = {
    format: 'nymph-novel-archive',
    version: 2,
    exportedAt: new Date().toISOString(),
    novel: {
      title: novel.title,
      author: novel.author,
      genre: novel.genre,
      summary: novel.summary,
      coverEmoji: novel.coverEmoji,
      coverImage: novel.coverImage,
      status: novel.status,
    },
    texts: {
      worldview: readNovelText(novelId, NOVEL_TEXT_KEYS.worldview),
      setting: readNovelText(novelId, NOVEL_TEXT_KEYS.setting),
      outlineOverview: readNovelText(novelId, NOVEL_TEXT_KEYS.outlineOverview),
      endingPlan: readNovelText(novelId, NOVEL_TEXT_KEYS.endingPlan),
      styleSample: readNovelText(novelId, NOVEL_TEXT_KEYS.styleSample),
    },
    preferences: getNovelPreferences(novelId),
    volumes,
    outline: listOutlineNodes(novelId).map(({ id: _id, novelId: _novelId, ...rest }) => rest),
    characters: listCharacters(novelId).map(({ novelId: _novelId, ...rest }) => rest),
    relations: listRelations(novelId),
    encyclopedia: listEncyclopedia(novelId).map(({ novelId: _novelId, ...rest }) => rest),
    timeline: {
      branches: listBranches(novelId),
      events: listTimelineEvents(novelId),
    },
    storyEvents: listStoryEvents(novelId),
  };

  return {
    fileName: `${sanitizeFileName(novel.title)}.json`,
    contentType: 'application/json; charset=utf-8',
    content: JSON.stringify(payload, null, 2),
  };
}

/** 按格式导出。 */
export function exportNovel(novelId: string, format: ExportFormat): ExportResult {
  switch (format) {
    case 'md':
      return exportAsMarkdown(novelId);
    case 'json':
      return exportAsJson(novelId);
    default:
      return exportAsTxt(novelId);
  }
}
