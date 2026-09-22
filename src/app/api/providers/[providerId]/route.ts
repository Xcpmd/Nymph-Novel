import { asBool, asInt, asString, asStringArray, handle, readBody } from '@/lib/api/http';
import { deleteProvider, getProvider, listProviders, setActiveProvider, updateProvider } from '@/lib/repo/library';
import { fetchProviderModels } from '@/lib/ai/client';
import type { ModelParams } from '@/lib/types';

interface RouteParams {
  params: Promise<{ providerId: string }>;
}

/** GET /api/providers/{providerId} 读取单个供应商，密钥以掩码返回。 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { providerId } = await params;
  return handle(() => ({ provider: getProvider(providerId) }));
}

/**
 * PATCH /api/providers/{providerId}
 * 更新配置。apiKey 字段未出现时保持原密钥不变，传空字符串则清除。
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  const { providerId } = await params;
  return handle(async () => {
    const body = await readBody(request);
    const provider = updateProvider(providerId, {
      name: asString(body.name),
      presetId: asString(body.presetId) as never,
      baseUrl: asString(body.baseUrl)?.replace(/\/+$/, ''),
      apiKey: asString(body.apiKey),
      defaultModel: asString(body.defaultModel),
      models: asStringArray(body.models),
      params: body.params as ModelParams | undefined,
      stream: asBool(body.stream),
      maxRetries: asInt(body.maxRetries, 0, 5),
      enabled: asBool(body.enabled),
      isActive: asBool(body.isActive),
    });
    return { provider, providers: listProviders() };
  });
}

/** DELETE /api/providers/{providerId} 删除供应商。 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const { providerId } = await params;
  return handle(() => {
    deleteProvider(providerId);
    return { ok: true, providers: listProviders() };
  });
}

/**
 * POST /api/providers/{providerId}
 * 执行动作：activate 切换当前模型，refreshModels 拉取模型列表。
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { providerId } = await params;
  return handle(async () => {
    const body = await readBody(request);
    const action = asString(body.action) ?? 'activate';

    if (action === 'activate') {
      setActiveProvider(providerId);
      return { ok: true, providers: listProviders() };
    }
    if (action === 'refreshModels') {
      const models = await fetchProviderModels(providerId);
      if (models.length > 0) {
        updateProvider(providerId, { models });
      } else {
        updateProvider(providerId, {});
      }
      return { ok: true, models, providers: listProviders() };
    }
    throw new Error(`不支持的动作：${action}`);
  });
}
