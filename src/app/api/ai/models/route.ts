import { asString, handle, readBody } from '@/lib/api/http';
import { chatOnce } from '@/lib/ai/client';
import { getActiveProvider, getProvider } from '@/lib/repo/library';

/**
 * POST /api/ai/models
 * 用于测试连接：向指定供应商发一条极短的对话请求，返回模型回显内容。
 */
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readBody(request);
    const providerId = asString(body.providerId);
    const model = asString(body.model);
    const provider = providerId ? getProvider(providerId) : getActiveProvider();
    if (!provider) throw new Error('供应商不存在');

    const result = await chatOnce({
      providerId: provider.id,
      model: model || provider.defaultModel,
      temperature: 0,
      maxTokens: 64,
      messages: [
        { role: 'system', content: '你是一个连通性测试端点，只回复一句极短的中文问候。' },
        { role: 'user', content: '请回复：连接正常' },
      ],
    });

    return {
      text: result.text.trim() || '（接口返回了空内容）',
      usage: result.usage,
      provider: {
        id: provider.id,
        name: provider.name,
        model: model || provider.defaultModel,
      },
    };
  });
}
