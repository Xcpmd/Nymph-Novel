import fs from 'node:fs';
import path from 'node:path';

/**
 * 文件回收站。
 *
 * 删除操作不再直接抹掉文件，而是按时间戳重命名后移入 public/.trash，
 * 误删的正文仍能从磁盘上找回来。
 *
 * 设计取舍：
 * 一，回收目录放在 public 下，用户可以直接在资源管理器里打开查看，
 *     代价是该目录会被静态服务暴露，因此仅适用于本机运行的单用户场景。
 * 二，任何一步失败都只记录告警并返回 null，不向上抛错。
 *     删除流程本身已经不可逆，不该因为归档失败而让整个操作报错，
 *     否则界面会显示失败而数据库记录其实已经清掉了。
 */

/** 回收目录的绝对路径。 */
export const TRASH_DIR = path.join(process.cwd(), 'public', '.trash');

/** 确保回收目录存在。 */
export function ensureTrashDir(): void {
  fs.mkdirSync(TRASH_DIR, { recursive: true });
}

/** 本地时间戳，形如 20260922-221530，便于按名称排序。 */
function timestamp(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`,
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`,
  ].join('-');
}

/** 在回收目录里找一个未被占用的名称。 */
function uniquePath(fileName: string): string {
  const direct = path.join(TRASH_DIR, fileName);
  if (!fs.existsSync(direct)) return direct;

  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  for (let index = 1; index < 1000; index += 1) {
    const candidate = path.join(TRASH_DIR, `${base}-${index}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(TRASH_DIR, `${base}-${Date.now()}${ext}`);
}

/**
 * 把一个文件或目录移入回收站。
 *
 * 归档后的名称是「时间戳-来源-原名」，来源用于区分正文、小说目录与迁移重复文件。
 * 返回归档后的绝对路径，失败时返回 null。
 */
export function moveToTrash(absolutePath: string, source = ''): string | null {
  if (!fs.existsSync(absolutePath)) return null;

  try {
    ensureTrashDir();
    const original = path.basename(absolutePath);
    const prefix = source ? `${source}-` : '';
    const target = uniquePath(`${timestamp()}-${prefix}${original}`);

    try {
      fs.renameSync(absolutePath, target);
    } catch (error) {
      // 数据目录被指向其他盘符时改名会失败，退回复制后删除
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      fs.cpSync(absolutePath, target, { recursive: true });
      fs.rmSync(absolutePath, { recursive: true, force: true });
    }
    return target;
  } catch (error) {
    console.warn(
      `[nymph] 移入回收站失败，文件保留在原处：${absolutePath} ${
        error instanceof Error ? error.message : ''
      }`,
    );
    return null;
  }
}

/** 回收目录中已有的条目数，供诊断与界面展示使用。 */
export function countTrashEntries(): number {
  if (!fs.existsSync(TRASH_DIR)) return 0;
  return fs.readdirSync(TRASH_DIR).length;
}
