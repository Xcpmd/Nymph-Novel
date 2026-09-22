import { asBool, asInt, asString, asStringArray, handle, readBody } from '@/lib/api/http';
import { createProvider, listProviders } from '@/lib/repo/library';
import { PROVIDER_PRESETS } from '@/lib/ai/presets';
import { ensureDefaultProviders } from '@/lib/service/bootstrap';
import type { ModelParams, ProviderPresetId } from '@/lib/types';

/** GET /api/providers 列出供应商与可选的预设清单。 */
export async function GET() {
  return handle(() => {
    ensureDefaultProviders();
    return {
      providers: listProviders(),
      presets: PROVIDER_PRESETS,
    };
  });
}

/** POST /api/providers 新增供应商。 */
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readBody(request);
    const presetId = (asString(body.presetId) ?? 'custom') as ProviderPresetId;
    const preset = PROVIDER_PRESETS.find((item) => item.id === presetId);

    const provider = createProvider({
      name: asString(body.name)?.trim() || preset?.name || '自定义供应商',
      presetId,
      baseUrl: (asString(body.baseUrl)?.trim() || preset?.baseUrl || '').replace(/\/+$/, ''),
      apiKey: asString(body.apiKey),
      defaultModel: asString(body.defaultModel)?.trim() || preset?.defaultModel || '',
      models: asStringArray(body.models) ?? preset?.models ?? [],
      params: (body.params as ModelParams | undefined) ?? preset?.params ?? {},
      stream: asBool(body.stream) ?? true,
      maxRetries: asInt(body.maxRetries, 0, 5) ?? 2,
      enabled: asBool(body.enabled) ?? true,
      isActive: asBool(body.isActive) ?? false,
    });

    return { provider, providers: listProviders() };
  });
}
