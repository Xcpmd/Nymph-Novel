import fs from 'node:fs';
import path from 'node:path';
import {
  chapterDirName,
  chapterRelPath,
  CONTENT_FILE_NAME,
  isContentFileName,
  isVolumeDir,
  isLegacyVolumeDir,
  legacyChapterRelPath,
  novelDir,
  normalizeContentRelPath,
  normalizeVolumeDirName,
  resolveInsideNovel,
  volumeDirName,
} from '../paths';
import { countWords } from '../token';
import { moveToTrash } from './trash';

/**
 * 章节正文的 Markdown 文件存储。
 *
 * 目录结构固定为 novel/{novelId}/vol-XXX/ch-YYY/content.md。
 * 数据库只保存元数据与相对路径，正文实体永远落在文件系统上，
 * 这样用户可以直接用任意编辑器打开、备份或纳入版本管理。
 *
 * 早期版本使用中文目录名，这里在读取时兼容旧路径，
 * 并在遇到旧位置时把文件搬到新位置，完成一次性平滑迁移。
 */

export interface ChapterFileContent {
  relPath: string;
  content: string;
  exists: boolean;
  wordCount: number;
}

/**
 * 把数据库里可能存着的旧中文路径解析到磁盘上真实存在的位置。
 *
 * 新写法直接返回；旧写法先看旧位置在不在，在就直接读，
 * 不在则尝试拉丁新位置。两条路都不存在时返回新位置，让调用方按空内容处理。
 */
function locateChapterFile(novelId: string, relPath: string): string {
  const candidate = resolveInsideNovel(novelId, relPath);
  if (fs.existsSync(candidate)) return candidate;

  const segments = relPath.split('/');
  if (segments.length !== 3) return candidate;
  const [volumeName, chapterName, fileName] = segments;
  if (!isLegacyVolumeDir(volumeName) && !isVolumeDir(volumeName)) return candidate;
  if (!isContentFileName(fileName)) return candidate;

  const volumeIndex = Number(volumeName.replace(/^\D+/, ''));
  const chapterIndex = Number(chapterName.replace(/^\D+/, ''));
  if (!Number.isFinite(volumeIndex) || !Number.isFinite(chapterIndex)) return candidate;

  // 旧中文位置
  const legacyPath = resolveInsideNovel(novelId, legacyChapterRelPath(volumeIndex, chapterIndex));
  if (fs.existsSync(legacyPath)) return legacyPath;

  // 拉丁新位置，正文文件名一并归一
  const normalizedPath = resolveInsideNovel(
    novelId,
    `${volumeDirName(volumeIndex)}/${chapterDirName(chapterIndex)}/${CONTENT_FILE_NAME}`,
  );
  if (fs.existsSync(normalizedPath)) return normalizedPath;

  return candidate;
}

/** 读取章节正文。文件不存在时返回空内容而不是抛错，便于新建章节直接进入编辑。 */
export function readChapterContent(novelId: string, relPath: string): ChapterFileContent {
  const absolute = locateChapterFile(novelId, relPath);
  if (!fs.existsSync(absolute)) {
    return { relPath, content: '', exists: false, wordCount: 0 };
  }
  const content = fs.readFileSync(absolute, 'utf8');
  return { relPath, content, exists: true, wordCount: countWords(content) };
}

/**
 * 写入章节正文，自动创建所需目录。
 *
 * 一律写入拉丁新路径。若同一章在旧中文位置已有文件，先把旧文件挪过来，
 * 避免出现新旧两份正文各写一半的情况。
 */
export function writeChapterContent(
  novelId: string,
  relPath: string,
  content: string,
): ChapterFileContent {
  const target = resolveInsideNovel(novelId, normalizeContentRelPath(relPath));
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const existing = locateChapterFile(novelId, relPath);
  if (existing !== target && fs.existsSync(existing)) {
    // 旧位置有内容而新位置还没有，说明是升级前留下的文件，先搬再覆盖
    fs.renameSync(existing, target);
  }

  fs.writeFileSync(target, content, 'utf8');
  return {
    relPath: normalizeContentRelPath(relPath),
    content,
    exists: true,
    wordCount: countWords(content),
  };
}

/**
 * 删除章节正文文件，并清理变空的章目录。
 *
 * 正文文件本身不直接抹除，而是移入回收站，误删后仍可找回。
 * 空目录没有内容可恢复，照常收掉，否则回删章节会在磁盘上留下成片的空壳。
 */
export function deleteChapterFile(novelId: string, relPath: string): void {
  const absolute = locateChapterFile(novelId, relPath);
  if (fs.existsSync(absolute)) {
    moveToTrash(absolute, 'chapter');
  }
  const dir = path.dirname(absolute);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
    fs.rmdirSync(dir);
  }
  // 章目录清空后卷目录也可能变空，一并收掉，避免留下空壳
  const volumeDir = path.dirname(dir);
  if (
    volumeDir !== novelDir(novelId) &&
    fs.existsSync(volumeDir) &&
    fs.readdirSync(volumeDir).length === 0
  ) {
    fs.rmdirSync(volumeDir);
  }
}

/**
 * 把已有正文文件移动到新的卷章位置，用于插入或删除章节后的重编号。
 *
 * 源路径可能是旧中文路径，统一先定位到磁盘上的真实位置再改名。
 */
export function moveChapterFile(novelId: string, fromRel: string, toRel: string): void {
  const normalizedTo = normalizeContentRelPath(toRel);
  if (normalizeContentRelPath(fromRel) === normalizedTo) return;
  const from = locateChapterFile(novelId, fromRel);
  const to = resolveInsideNovel(novelId, normalizedTo);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (fs.existsSync(from)) {
    fs.renameSync(from, to);
    const oldDir = path.dirname(from);
    if (oldDir !== path.dirname(to) && fs.existsSync(oldDir) && fs.readdirSync(oldDir).length === 0) {
      fs.rmdirSync(oldDir);
    }
  } else {
    fs.writeFileSync(to, '', 'utf8');
  }
}

/** 列出小说目录下实际存在的所有卷目录名，含历史中文目录，统一归一为拉丁写法。 */
export function listVolumeDirs(novelId: string): string[] {
  const base = novelDir(novelId);
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && (isVolumeDir(entry.name) || isLegacyVolumeDir(entry.name)),
    )
    .map((entry) => normalizeVolumeDirName(entry.name))
    .filter((name, index, all) => all.indexOf(name) === index)
    .sort();
}

/** 创建小说目录骨架，包含第一卷一第一章占位，避免空目录在资源管理器里不可见。 */
export function ensureNovelSkeleton(novelId: string, volumeIndex = 1): void {
  const dir = path.join(novelDir(novelId), volumeDirName(volumeIndex));
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * 把小说目录下残留的中文卷章目录整体迁移为拉丁写法。
 *
 * relPaths 传入候选路径，调用方会把库里的拉丁路径与还原出的中文路径一起给出，
 * 无论库里存的是哪一套命名，都能定位到磁盘上的旧目录。
 * 返回实际改名的数量，供调用方记录日志。
 */
export function migrateChapterDirsOnDisk(novelId: string, relPaths: string[]): number {
  let migrated = 0;
  const seen = new Set<string>();
  for (const relPath of relPaths) {
    if (seen.has(relPath)) continue;
    seen.add(relPath);

    const segments = relPath.split('/');
    if (segments.length !== 3) continue;
    const [volumeName, chapterName, fileName] = segments;
    if (!isLegacyVolumeDir(volumeName)) continue;
    if (!isContentFileName(fileName)) continue;

    const volumeIndex = Number(volumeName.replace(/^\D+/, ''));
    const chapterIndex = Number(chapterName.replace(/^\D+/, ''));
    if (!Number.isFinite(volumeIndex) || !Number.isFinite(chapterIndex)) continue;

    let from: string;
    try {
      from = resolveInsideNovel(novelId, relPath);
    } catch {
      continue;
    }
    if (!fs.existsSync(from)) continue;

    // 目标一律使用拉丁目录名与拉丁正文文件名，不沿用旧的 正文.md
    const to = resolveInsideNovel(
      novelId,
      `${volumeDirName(volumeIndex)}/${chapterDirName(chapterIndex)}/${CONTENT_FILE_NAME}`,
    );
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (fs.existsSync(to)) {
      // 目标已存在说明此前迁移过。旧文件仍先归档再丢弃，
      // 万一内容与目标不同也有据可查，不直接抹掉。
      moveToTrash(from, 'legacy-duplicate');
    } else {
      fs.renameSync(from, to);
    }
    migrated++;
  }

  if (migrated > 0) {
    // 清掉迁移后空掉的中文卷目录
    const base = novelDir(novelId);
    if (fs.existsSync(base)) {
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory() || !isLegacyVolumeDir(entry.name)) continue;
        const full = path.join(base, entry.name);
        // 逐层收掉空目录，中文卷目录下可能还留着空的章目录
        for (const inner of fs.readdirSync(full, { withFileTypes: true })) {
          if (!inner.isDirectory()) continue;
          const innerFull = path.join(full, inner.name);
          if (fs.readdirSync(innerFull).length === 0) fs.rmdirSync(innerFull);
        }
        if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
      }
    }
  }
  return migrated;
}

/**
 * 删除整部小说的正文目录。
 *
 * 整个目录移入回收站而不是就地抹除，误删小说时正文仍可找回。
 * 数据库记录此时已经删掉，归档失败不应把整个删除操作判为失败，
 * 否则界面会显示错误而数据其实已经不存在，因此失败只记录告警。
 */
export function deleteNovelFiles(novelId: string): void {
  const base = novelDir(novelId);
  if (base !== novelDir(novelId) || !fs.existsSync(base)) return;
  // 目录名本身已经是小说标识，归档名前缀不再重复带上
  moveToTrash(base, 'novel');
}

/** 统计小说目录占用的磁盘空间。 */
export function getNovelDiskUsage(novelId: string): number {
  const base = novelDir(novelId);
  if (!fs.existsSync(base)) return 0;
  let total = 0;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        total += fs.statSync(full).size;
      }
    }
  };
  walk(base);
  return total;
}

/** 计算某卷某章的相对路径，统一收敛到这里，避免各处硬编码目录名。 */
export function buildRelPath(volumeIndex: number, chapterIndex: number): string {
  return chapterRelPath(volumeIndex, chapterIndex);
}
