import fs from 'node:fs';
import path from 'node:path';
import { novelCoverFile, novelDir } from '../paths';

/**
 * 小说封面的存取。
 *
 * 封面在界面上以 data URI 或接口地址喂给 <img>，但落到磁盘上就是一张图片。
 * 先前把它整串 base64 存进数据库，单行就占掉八十多万字节，
 * 既撑大了库，也让整部小说没法作为一个目录整体搬走。
 *
 * 这里只负责文件层面的读写，数据库里不再保留图片内容。
 */

/** 从 data URI 里拆出实际格式与二进制内容。 */
function parseDataUri(dataUri: string): { mime: string; buffer: Buffer } | null {
  const match = /^data:([^;,]+);base64,(.*)$/su.exec(dataUri.trim());
  if (!match) return null;
  try {
    return { mime: match[1] ?? 'image/png', buffer: Buffer.from(match[2] ?? '', 'base64') };
  } catch {
    return null;
  }
}

/**
 * 按文件头判断图片格式。
 *
 * 文件名固定为 cover.png，但内容可能是 webp —— 前端上传的格式并不受控，
 * 因此返回给浏览器时以实际魔数为准，避免 Content-Type 与实际内容不符。
 */
function sniffMime(buffer: Buffer): string {
  if (buffer.length >= 12) {
    if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
        buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
      return 'image/webp';
    }
    if (buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 6 && buffer.subarray(0, 6).toString('latin1').startsWith('GIF8')) {
    return 'image/gif';
  }
  return 'image/png';
}

/** 写入封面。传入 data URI，非法的内容会被忽略并返回 false。 */
export function writeNovelCover(novelId: string, dataUri: string): boolean {
  const parsed = parseDataUri(dataUri);
  if (!parsed || parsed.buffer.length === 0) return false;
  fs.mkdirSync(novelDir(novelId), { recursive: true });
  fs.writeFileSync(novelCoverFile(novelId), parsed.buffer);
  return true;
}

/** 读取封面的二进制内容，没有封面时返回 null。 */
export function readNovelCover(novelId: string): { buffer: Buffer; mime: string } | null {
  const file = novelCoverFile(novelId);
  if (!fs.existsSync(file)) return null;
  try {
    const buffer = fs.readFileSync(file);
    if (buffer.length === 0) return null;
    return { buffer, mime: sniffMime(buffer) };
  } catch {
    return null;
  }
}

/** 删除封面文件，顺带清理空目录。 */
export function deleteNovelCover(novelId: string): void {
  const file = novelCoverFile(novelId);
  if (!fs.existsSync(file)) return;
  fs.unlinkSync(file);
  // 目录里只剩封面时一并收掉，避免删了小说还留一堆空壳
  try {
    const dir = novelDir(novelId);
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch {
    // 目录非空或被占用时保持原样
  }
}

/** 判断封面文件是否存在。 */
export function hasNovelCover(novelId: string): boolean {
  return fs.existsSync(novelCoverFile(novelId));
}

/** 封面文件的绝对路径供静态服务与导出使用。 */
export function novelCoverPath(novelId: string): string {
  return path.resolve(novelCoverFile(novelId));
}
