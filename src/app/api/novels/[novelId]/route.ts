import { asString, fail, handle, readBody } from '@/lib/api/http';
import { getNovel, deleteNovel, updateNovel } from '@/lib/repo/novels';
import type { CoverFit, NovelStatus } from '@/lib/types';

const NOVEL_STATUS: NovelStatus[] = ['drafting', 'ongoing', 'paused', 'finished'];
const COVER_FIT: CoverFit[] = ['cover', 'contain'];

interface RouteParams {
  params: Promise<{ novelId: string }>;
}

/** GET /api/novels/{novelId} 读取小说基础信息。 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { novelId } = await params;
  return handle(() => {
    const novel = getNovel(novelId);
    if (!novel) return fail('小说不存在', 404);
    return { novel };
  });
}

/** PATCH /api/novels/{novelId} 更新小说基础信息。 */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { novelId } = await params;
  return handle(async () => {
    const body = await readBody(request);
    const status = asString(body.status);
    const coverFit = asString(body.coverFit);
    const novel = updateNovel(novelId, {
      title: asString(body.title),
      author: asString(body.author),
      genre: asString(body.genre),
      summary: asString(body.summary),
      coverEmoji: asString(body.coverEmoji),
      coverImage: asString(body.coverImage),
      coverFit:
        coverFit && COVER_FIT.includes(coverFit as CoverFit) ? (coverFit as CoverFit) : undefined,
      status:
        status && NOVEL_STATUS.includes(status as NovelStatus) ? (status as NovelStatus) : undefined,
    });
    if (!novel) return fail('小说不存在', 404);
    return { novel };
  });
}

/** DELETE /api/novels/{novelId} 删除小说及其正文目录。 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const { novelId } = await params;
  return handle(() => {
    if (!getNovel(novelId)) return fail('小说不存在', 404);
    deleteNovel(novelId);
    return { ok: true };
  });
}
