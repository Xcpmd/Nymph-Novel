import { fail, handle, readBody } from '@/lib/api/http';
import { RESOURCES, hasResource, requireNovel } from '@/lib/api/resources';

/**
 * GET    /api/novels/{novelId}/{resource}/{itemId}
 * PATCH  /api/novels/{novelId}/{resource}/{itemId}
 * DELETE /api/novels/{novelId}/{resource}/{itemId}
 */

interface RouteParams {
  params: Promise<{ novelId: string; resource: string; itemId: string }>;
}

export async function GET(request: Request, { params }: RouteParams) {
  const { novelId, resource, itemId } = await params;
  return handle(() => {
    requireNovel(novelId);
    if (!hasResource(resource)) return fail(`未注册的资源类型：${resource}`, 404);
    const definition = RESOURCES[resource]!;
    if (!definition.getItem) return fail(`资源 ${resource} 不支持单项读取`, 405);
    return definition.getItem({ novelId, itemId, url: new URL(request.url), body: {} });
  });
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { novelId, resource, itemId } = await params;
  return handle(async () => {
    requireNovel(novelId);
    if (!hasResource(resource)) return fail(`未注册的资源类型：${resource}`, 404);
    const definition = RESOURCES[resource]!;
    if (!definition.updateItem) return fail(`资源 ${resource} 不支持更新`, 405);
    const body = await readBody(request);
    return definition.updateItem({ novelId, itemId, url: new URL(request.url), body });
  });
}

export async function DELETE(request: Request, { params }: RouteParams) {
  const { novelId, resource, itemId } = await params;
  return handle(() => {
    requireNovel(novelId);
    if (!hasResource(resource)) return fail(`未注册的资源类型：${resource}`, 404);
    const definition = RESOURCES[resource]!;
    if (!definition.deleteItem) return fail(`资源 ${resource} 不支持删除`, 405);
    return definition.deleteItem({ novelId, itemId, url: new URL(request.url), body: {} });
  });
}
