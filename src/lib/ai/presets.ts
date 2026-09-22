import type { ModelParams, ProviderPresetId } from '../types';

/**
 * 预置供应商。
 * 全部走 OpenAI 兼容的 chat completions 协议，因此只需要替换 baseUrl 与模型名即可接入。
 * 这里列出的地址与模型为默认值，用户可以在设置页任意修改。
 */
export interface ProviderPreset {
  id: ProviderPresetId;
  name: string;
  baseUrl: string;
  models: string[];
  defaultModel: string;
  docsUrl: string;
  note: string;
  params: ModelParams;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat',
    docsUrl: 'https://platform.deepseek.com/api-docs',
    note: '长文本续写性价比高，deepseek-chat 适合正文生成，deepseek-reasoner 适合大纲推演。',
    params: { temperature: 1.0, topP: 0.95, maxTokens: 8192 },
  },
  {
    id: 'glm',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4.6', 'glm-4.5', 'glm-4-plus', 'glm-4-flash'],
    defaultModel: 'glm-4.6',
    docsUrl: 'https://open.bigmodel.cn/dev/api',
    note: '中文语感强，长上下文稳定，适合设定密集型作品。',
    params: { temperature: 0.9, topP: 0.9, maxTokens: 8192 },
  },
  {
    id: 'mimo',
    name: '小米 MiMo',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    models: ['mimo-v2.5-pro', 'mimo-v2.5', 'mimo-v2-flash'],
    defaultModel: 'mimo-v2.5-pro',
    docsUrl: 'https://platform.xiaomimimo.com/docs',
    note: '订阅制使用 Token Plan 时，把地址换成 https://token-plan-cn.xiaomimimo.com/v1。',
    params: { temperature: 1.0, topP: 0.95, maxTokens: 8192 },
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4.1', 'gpt-4o', 'gpt-4o-mini'],
    defaultModel: 'gpt-4.1',
    docsUrl: 'https://platform.openai.com/docs/api-reference',
    note: '需要自备网络环境；也可以用任意中转地址替换 baseUrl。',
    params: { temperature: 1.0, maxTokens: 8192 },
  },
  {
    id: 'ollama',
    name: '本地 Ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: ['qwen2.5:14b', 'llama3.1:8b'],
    defaultModel: 'qwen2.5:14b',
    docsUrl: 'https://github.com/ollama/ollama/blob/main/docs/openai.md',
    note: '完全离线，数据不出本机。API Key 留空即可。',
    params: { temperature: 0.9, maxTokens: 4096 },
  },
  {
    id: 'custom',
    name: '自定义供应商',
    baseUrl: '',
    models: [],
    defaultModel: '',
    docsUrl: '',
    note: '只要你提供 OpenAI 兼容的 chat completions 接口即可接入。',
    params: { temperature: 1.0, maxTokens: 4096 },
  },
];

export function findPreset(presetId: string | null | undefined): ProviderPreset | null {
  if (!presetId) return null;
  return PROVIDER_PRESETS.find((preset) => preset.id === presetId) ?? null;
}
