import { NextResponse } from 'next/server';
import { readNovelCover } from '@/lib/store/cover';

/**
 * 读取小说封面。
 *
 * 图片存在 data/novel/{novelId}/cover.png，不在 public 下，
 * 因此需要一个接口把它送出去。Content-Type 按文件头判断，
 * 因为上传的格式并不受控 —— 原图可能是 webp 或 jpeg，
 * 文件名却统一叫 cover.png。
 */
export async function GET(_request: Request, { params }: { params: Promise<{ novelId: string }> }) {
  const { novelId } = await params;
  const cover = readNovelCover(novelId);
  if (!cover) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(cover.buffer), {
    headers: {
      'Content-Type': cover.mime,
      // 封面变动不频繁，允许浏览器短暂缓存；换封面时地址会带上时间戳绕过缓存
      'Cache-Control': 'public, max-age=300',
    },
  });
}
