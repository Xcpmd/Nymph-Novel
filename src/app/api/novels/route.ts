import { asString, handle, readBody } from '@/lib/api/http';
import { createNovel, listNovels } from '@/lib/repo/novels';
import { getAppSettings } from '@/lib/repo/settings';

/** GET /api/novels 列出全部小说。 */
export async function GET() {
  return handle(() => {
    const novels = listNovels();
    const settings = getAppSettings();
    return { novels, settings };
  });
}

/** POST /api/novels 新建小说，同时创建首卷与主线时间轴。 */
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readBody(request);
    const novel = createNovel({
      title: asString(body.title) ?? '',
      author: asString(body.author),
      genre: asString(body.genre),
      summary: asString(body.summary),
      coverEmoji: asString(body.coverEmoji),
    });
    return { novel, novels: listNovels() };
  });
}
