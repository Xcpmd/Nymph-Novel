import { fail, handle, readBody } from '@/lib/api/http';
import { RESOURCES, hasResource, requireNovel } from '@/lib/api/resources';

/**
 * GET  /api/novels/{novelId}/{resource}
 * POST /api/novels/{novelId}/{resource}
 *
 * 资源分发。所有小说内数据共用同一套语义，具体行为由 resources.ts 中的注册表决定。
 */

interface RouteParams {
  params: Promise<{ novelId: string; resource: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  const { novelId, resource } = await params;
  return handle(() => {
    requireNovel(novelId);
    if (!hasResource(resource)) return fail(`未注册的资源类型：${resource}`, 404);
    const definition = RESOURCES[resource]!;
    if (!definition.list) return fail(`资源 ${resource} 不支持列表读取`, 405);
    return definition.list({ novelId, url: new URL(request.url), body: {} });
  });
}

export async function POST(request: Request, { params }: RouteParams) {
  const { novelId, resource } = await params;
  return handle(async () => {
    requireNovel(novelId);
    if (!hasResource(resource)) return fail(`未注册的资源类型：${resource}`, 404);
    const definition = RESOURCES[resource]!;
    if (!definition.create) return fail(`资源 ${resource} 不支持新建`, 405);
    const body = await readBody(request);
    return definition.create({ novelId, url: new URL(request.url), body });
  });
}

/**
 * PATCH /api/novels/{novelId}/{resource}
 * 单例资源的整体更新，例如小说配置。带条目标识的资源请使用下一级地址。
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { novelId, resource } = await params;
  return handle(async () => {
    requireNovel(novelId);
    if (!hasResource(resource)) return fail(`未注册的资源类型：${resource}`, 404);
    const definition = RESOURCES[resource]!;
    if (!definition.updateSelf) {
      return fail(`资源 ${resource} 需要指定条目地址才能更新`, 405);
    }
    const body = await readBody(request);
    return definition.updateSelf({ novelId, url: new URL(request.url), body });
  });
}
