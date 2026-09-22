import path from 'node:path';

/**
 * 全部本地数据的根目录。
 * 默认位于项目根目录下的 data，可通过环境变量 NYMPH_DATA_DIR 覆盖。
 * 该目录被 .gitignore 排除，不会进入版本库，也不会对外上传。
 */
export const DATA_DIR = process.env.NYMPH_DATA_DIR
  ? path.resolve(process.env.NYMPH_DATA_DIR)
  : path.join(process.cwd(), 'data');

/** SQLite 数据库文件路径，存放元数据、索引、设定、角色、大纲、配置等结构化数据。 */
export const DB_FILE = path.join(DATA_DIR, 'nymph.db');

/** 主密钥文件路径，用于加密 API Key，权限位 0600。 */
export const MASTER_KEY_FILE = path.join(DATA_DIR, 'master.key');

/** 所有小说正文的根目录。 */
export const NOVEL_ROOT = path.join(DATA_DIR, 'novel');

/** 某部小说的根目录。 */
export function novelDir(novelId: string): string {
  return path.join(NOVEL_ROOT, novelId);
}

/**
 * 按需求文档固定目录结构生成路径：
 * novel/{novelId}/vol-001/ch-001/正文.md
 *
 * 目录名一律使用拉丁字符。中文目录名在跨系统迁移、打包、命令行工具处理时
 * 容易遇到编码问题，因此磁盘上不出现中文，界面展示层再翻译回中文。
 */

/** 卷目录名的前缀与历史中文前缀。 */
const VOLUME_PREFIX = 'vol-';
const LEGACY_VOLUME_PREFIX = '卷-';

/** 章目录名的前缀与历史中文前缀。 */
const CHAPTER_PREFIX = 'ch-';
const LEGACY_CHAPTER_PREFIX = '章-';

/** 正文文件名。磁盘上不出现中文，因此用 content.md。 */
export const CONTENT_FILE_NAME = 'content.md';

/** 卷目录名，例如 vol-001。 */
export function volumeDirName(volumeIndex: number): string {
  return `${VOLUME_PREFIX}${String(volumeIndex).padStart(3, '0')}`;
}

/** 章目录名，例如 ch-001。 */
export function chapterDirName(chapterIndex: number): string {
  return `${CHAPTER_PREFIX}${String(chapterIndex).padStart(3, '0')}`;
}

/** 章节正文相对路径，例如 vol-001/ch-002/content.md，统一使用正斜杠便于展示与存储。 */
export function chapterRelPath(volumeIndex: number, chapterIndex: number): string {
  return `${volumeDirName(volumeIndex)}/${chapterDirName(chapterIndex)}/${CONTENT_FILE_NAME}`;
}

/** 历史中文卷目录名，例如 卷-001。 */
export function legacyVolumeDirName(volumeIndex: number): string {
  return `${LEGACY_VOLUME_PREFIX}${String(volumeIndex).padStart(3, '0')}`;
}

/** 历史中文章目录名，例如 章-001。 */
export function legacyChapterDirName(chapterIndex: number): string {
  return `${LEGACY_CHAPTER_PREFIX}${String(chapterIndex).padStart(3, '0')}`;
}

/** 历史中文正文文件名。 */
export const LEGACY_CONTENT_FILE_NAME = '正文.md';

/** 历史中文章节相对路径，例如 卷-001/章-001/正文.md。 */
export function legacyChapterRelPath(volumeIndex: number, chapterIndex: number): string {
  return `${legacyVolumeDirName(volumeIndex)}/${legacyChapterDirName(chapterIndex)}/${LEGACY_CONTENT_FILE_NAME}`;
}

/** 判断一个卷目录名是否是历史中文写法。 */
export function isLegacyVolumeDir(name: string): boolean {
  return name.startsWith(LEGACY_VOLUME_PREFIX);
}

/** 判断一个卷目录名是否是现行拉丁写法。 */
export function isVolumeDir(name: string): boolean {
  return name.startsWith(VOLUME_PREFIX);
}

/** 判断正文文件名是否属于章节正文，同时接受现行与历史写法。 */
export function isContentFileName(name: string): boolean {
  return name === CONTENT_FILE_NAME || name === LEGACY_CONTENT_FILE_NAME;
}

/**
 * 把任意卷目录名归一为拉丁写法。
 *
 * 读取阶段用它兼容中文旧目录，写入阶段永远产出拉丁目录名。
 */
export function normalizeVolumeDirName(name: string): string {
  if (isVolumeDir(name)) return name;
  if (isLegacyVolumeDir(name)) {
    return VOLUME_PREFIX + name.slice(LEGACY_VOLUME_PREFIX.length);
  }
  return name;
}

/** 把任意章目录名归一为拉丁写法。 */
export function normalizeChapterDirName(name: string): string {
  if (name.startsWith(CHAPTER_PREFIX)) return name;
  if (name.startsWith(LEGACY_CHAPTER_PREFIX)) {
    return CHAPTER_PREFIX + name.slice(LEGACY_CHAPTER_PREFIX.length);
  }
  return name;
}

/**
 * 把存储中的正文相对路径归一为拉丁写法。
 *
 * 数据库里可能存着早期写入的中文路径，读取时统一换算，
 * 让上层不必关心磁盘上到底是哪一套命名。
 */
export function normalizeContentRelPath(relPath: string): string {
  return relPath
    .replace(new RegExp(`^${LEGACY_VOLUME_PREFIX}`, 'u'), VOLUME_PREFIX)
    .replace(new RegExp(`/${LEGACY_CHAPTER_PREFIX}`, 'gu'), `/${CHAPTER_PREFIX}`)
    .replace(new RegExp(`/${LEGACY_CONTENT_FILE_NAME}$`, 'u'), `/${CONTENT_FILE_NAME}`);
}

/**
 * 将相对路径解析为绝对路径，并阻止越界访问。
 * 任何企图用 .. 逃逸出小说目录的路径都会被拒绝。
 */
export function resolveInsideNovel(novelId: string, relPath: string): string {
  const base = novelDir(novelId);
  const target = path.resolve(base, relPath);
  const normalizedBase = path.resolve(base);
  if (target !== normalizedBase && !target.startsWith(normalizedBase + path.sep)) {
    throw new Error('路径越界：拒绝访问小说目录之外的文件');
  }
  return target;
}

/** 文件名清洗，用于导出等场景。 */
export function sanitizeFileName(name: string, fallback = 'untitled'): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : fallback;
}
