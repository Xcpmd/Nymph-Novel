import { getActiveProvider, getProvider, getProviderSecret } from '../repo/library';
import { estimateTokens } from '../token';
import { getNovelPreferences } from '../repo/settings';
import { getBuiltinPrompt, renderTemplate } from './prompts';
import type { ModelParams, Provider, TaskType } from '../types';

/**
 * OpenAI 兼容协议的模型客户端。
 *
 * 统一处理：请求组装、流式解析、错误重试、token 统计。
 * 所有供应商都走同一套协议，因此新增供应商只需要填写接口地址与模型名。
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ResolvedModel {
  provider: Provider;
  apiKey: string;
  baseUrl: string;
  model: string;
  params: ModelParams;
  stream: boolean;
  maxRetries: number;
}

export class MissingProviderError extends Error {
  constructor() {
    super('尚未配置可用的模型供应商，请先在设置页添加并启用一个供应商');
    this.name = 'MissingProviderError';
  }
}

export class MissingApiKeyError extends Error {
  constructor(providerName: string) {
    super(`供应商 ${providerName} 尚未填写 API Key`);
    this.name = 'MissingApiKeyError';
  }
}

/** 解析要使用的模型配置。未指定时使用当前激活的供应商。 */
export function resolveModel(providerId?: string | null): ResolvedModel {
  const provider = providerId ? getProvider(providerId) : getActiveProvider();
  if (!provider) throw new MissingProviderError();

  const apiKey = getProviderSecret(provider.id);
  const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)/.test(provider.baseUrl);
  if (!apiKey && !isLocal) throw new MissingApiKeyError(provider.name);

  return {
    provider,
    apiKey,
    baseUrl: provider.baseUrl.replace(/\/+$/, ''),
    model: provider.defaultModel,
    params: provider.params ?? {},
    stream: provider.stream,
    maxRetries: Math.max(0, Math.min(5, provider.maxRetries)),
  };
}

export interface ChatRequest {
  messages: ChatMessage[];
  providerId?: string | null;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  paramsOverride?: ModelParams;
  responseFormat?: 'text' | 'json';
  signal?: AbortSignal;
}

export interface UsageReport {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated: boolean;
}

export type StreamChunk =
  | { type: 'delta'; text: string }
  /** 推理模型的思考过程，只用于界面展示，不进入正文 */
  | { type: 'reasoning'; text: string }
  | { type: 'usage'; usage: UsageReport }
  | { type: 'done'; text: string; usage: UsageReport; finishReason?: string }
  | { type: 'error'; message: string };

function buildBody(request: ChatRequest, resolved: ResolvedModel, stream: boolean): Record<string, unknown> {
  const params: ModelParams = { ...resolved.params, ...request.paramsOverride };
  const body: Record<string, unknown> = {
    model: request.model || resolved.model,
    messages: request.messages,
    stream,
  };
  if (stream) {
    // 让兼容接口在流结束时回传用量，能拿到就覆盖本地估算
    body.stream_options = { include_usage: true };
  }
  if (request.temperature !== undefined) body.temperature = request.temperature;
  else if (params.temperature !== undefined) body.temperature = params.temperature;
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
  else if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens;
  if (params.topP !== undefined) body.top_p = params.topP;
  if (params.presencePenalty !== undefined) body.presence_penalty = params.presencePenalty;
  if (params.frequencyPenalty !== undefined) body.frequency_penalty = params.frequencyPenalty;
  if (params.stop && params.stop.length > 0) body.stop = params.stop;
  if (request.responseFormat === 'json') body.response_format = { type: 'json_object' };
  return body;
}

function buildHeaders(resolved: ResolvedModel): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (resolved.apiKey) headers.Authorization = `Bearer ${resolved.apiKey}`;
  return headers;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** 一帧 SSE 数据解析出的内容。空帧返回 null。 */
export interface ParsedStreamLine {
  /** 正文增量 */
  content: string;
  /** 推理过程增量，正文之外的思考内容 */
  reasoning: string;
  /** 结束原因，`length` 表示撞到输出上限被截断 */
  finishReason?: string;
  /** 本次携带的用量 */
  usage?: UsageReport;
}

/**
 * 解析一行 SSE 数据。
 *
 * 单独抽出来是因为这里踩过一次很隐蔽的坑：OpenAI 兼容协议下，
 * 推理模型把思考过程放在 `reasoning_content`，此时 `content` 是 null。
 * 只读 `content` 会把整条流全部丢弃，而 `usage` 仍照常返回，
 * 上层于是把「一个字都没有」记成「生成完成」。
 */
export function parseStreamLine(rawLine: string): ParsedStreamLine | null {
  const line = rawLine.trim();
  if (!line || !line.startsWith('data:')) return null;
  const payload = line.slice(5).trim();
  if (!payload || payload === '[DONE]') return null;

  try {
    const parsed = JSON.parse(payload) as {
      choices?: Array<{
        delta?: { content?: string | null; reasoning_content?: string | null };
        finish_reason?: string | null;
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };
    const choice = parsed.choices?.[0];
    const result: ParsedStreamLine = {
      content: typeof choice?.delta?.content === 'string' ? choice.delta.content : '',
      reasoning:
        typeof choice?.delta?.reasoning_content === 'string' ? choice.delta.reasoning_content : '',
    };
    if (typeof choice?.finish_reason === 'string' && choice.finish_reason) {
      result.finishReason = choice.finish_reason;
    }
    if (parsed.usage) {
      result.usage = {
        promptTokens: parsed.usage.prompt_tokens ?? 0,
        completionTokens: parsed.usage.completion_tokens ?? 0,
        totalTokens:
          parsed.usage.total_tokens ??
          (parsed.usage.prompt_tokens ?? 0) + (parsed.usage.completion_tokens ?? 0),
        estimated: false,
      };
    }
    return result;
  } catch {
    // 兼容接口偶尔会输出非 JSON 的心跳行，忽略即可
    return null;
  }
}

/**
 * 发起流式对话。
 * 调用方通过 for await 逐块消费增量文本，可随时中断。
 */
export async function* chatStream(request: ChatRequest): AsyncGenerator<StreamChunk> {
  const resolved = resolveModel(request.providerId);
  const url = `${resolved.baseUrl}/chat/completions`;
  const body = buildBody(request, resolved, true);
  const headers = buildHeaders(resolved);

  let attempt = 0;
  let lastError = '';

  while (attempt <= resolved.maxRetries) {
    attempt += 1;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: request.signal,
      });
    } catch (error) {
      if (request.signal?.aborted) {
        yield { type: 'error', message: '生成已中断' };
        return;
      }
      lastError = error instanceof Error ? error.message : '网络请求失败';
      if (attempt > resolved.maxRetries) {
        yield { type: 'error', message: `请求失败：${lastError}` };
        return;
      }
      await sleep(Math.min(4000, 400 * 2 ** attempt));
      continue;
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      lastError = `接口返回 ${response.status}：${detail.slice(0, 500)}`;
      // 认证与参数错误重试没有意义，直接返回
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        yield { type: 'error', message: lastError };
        return;
      }
      if (attempt > resolved.maxRetries) {
        yield { type: 'error', message: lastError };
        return;
      }
      await sleep(Math.min(6000, 600 * 2 ** attempt));
      continue;
    }

    if (!response.body) {
      yield { type: 'error', message: '响应没有内容体，无法读取流式数据' };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let full = '';
    let usage: UsageReport | null = null;
    /**
     * 上游给出的结束原因。
     *
     * `length` 表示撞到 max_tokens 被硬截断，正文可能根本没开始写，
     * 必须让调用方拿到这个信号，否则会把「被截断」当成「已完成」。
     */
    let finishReason: string | undefined;
    /** 本次是否有任何推理增量，用于判断 8192 个 token 是不是全烧在思考上 */
    let reasoningChars = 0;

    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (request.signal?.aborted) {
          const finalUsage = usage ?? {
            promptTokens: estimateTokens(request.messages.map((message) => message.content).join('')),
            completionTokens: estimateTokens(full),
            totalTokens:
              estimateTokens(request.messages.map((message) => message.content).join('')) +
              estimateTokens(full),
            estimated: true,
          };
          yield { type: 'done', text: full, usage: finalUsage, finishReason };
          return;
        }
        yield { type: 'error', message: error instanceof Error ? error.message : '读取响应流失败' };
        return;
      }

      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const piece = parseStreamLine(rawLine);
        if (!piece) continue;
        if (piece.content) {
          full += piece.content;
          yield { type: 'delta', text: piece.content };
        }
        /*
         * 推理模型会把思考过程写在 reasoning_content 里，此时 content 为 null。
         *
         * 只读 content 会让整段思考连同后续正文一起被丢掉：
         * 曾经出现的「显示生成完成但内容区一片空白」就是这么来的——
         * 模型把额度全花在思考上，content 始终为空，而 usage 照常回传，
         * 界面据此判定成功，用户白付了 token。
         */
        if (piece.reasoning) {
          reasoningChars += piece.reasoning.length;
          yield { type: 'reasoning', text: piece.reasoning };
        }
        if (piece.finishReason) finishReason = piece.finishReason;
        if (piece.usage) usage = piece.usage;
      }
    }

    /*
     * 正文为空却有推理内容，说明额度被思考耗尽。
     * 转成一条明确的错误，避免上层把这种情况记成成功。
     */
    if (!full && reasoningChars > 0) {
      const reason =
        finishReason === 'length'
          ? `模型把本次输出额度全部用于思考过程，未产出正文。请调高最大输出长度，或改用非推理模型。`
          : `模型只返回了思考过程，未产出正文。请重试或改用非推理模型。`;
      yield { type: 'error', message: reason };
      return;
    }

    const promptTokens = estimateTokens(
      request.messages.map((message) => message.content).join('\n'),
    );
    const finalUsage: UsageReport =
      usage ??
      {
        promptTokens,
        completionTokens: estimateTokens(full),
        totalTokens: promptTokens + estimateTokens(full),
        estimated: true,
      };
    yield { type: 'done', text: full, usage: finalUsage, finishReason };
    return;
  }

  yield { type: 'error', message: lastError || '生成失败' };
}

/**
 * 一次性对话，返回完整文本。
 * 用于结构化的辅助任务，例如抽出角色或整理时间轴。
 */
export async function chatOnce(
  request: ChatRequest,
): Promise<{ text: string; usage: UsageReport }> {
  const resolved = resolveModel(request.providerId);
  const url = `${resolved.baseUrl}/chat/completions`;
  const body = buildBody(request, resolved, false);
  const headers = buildHeaders(resolved);

  let attempt = 0;
  let lastError = '';
  while (attempt <= resolved.maxRetries) {
    attempt += 1;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: request.signal,
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        lastError = `接口返回 ${response.status}：${detail.slice(0, 500)}`;
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          throw new Error(lastError);
        }
        await sleep(Math.min(6000, 600 * 2 ** attempt));
        continue;
      }
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const text = payload.choices?.[0]?.message?.content ?? '';
      const promptTokens =
        payload.usage?.prompt_tokens ??
        estimateTokens(request.messages.map((message) => message.content).join('\n'));
      const completionTokens = payload.usage?.completion_tokens ?? estimateTokens(text);
      return {
        text,
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: payload.usage?.total_tokens ?? promptTokens + completionTokens,
          estimated: !payload.usage,
        },
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : '请求失败';
      if (attempt > resolved.maxRetries) break;
      await sleep(Math.min(6000, 600 * 2 ** attempt));
    }
  }
  throw new Error(lastError || '生成失败');
}

/** 拉取供应商的模型列表，用于设置页一键刷新。 */
export async function fetchProviderModels(providerId: string): Promise<string[]> {
  const provider = getProvider(providerId);
  if (!provider) throw new Error('供应商不存在');
  const apiKey = getProviderSecret(providerId);
  const response = await fetch(`${provider.baseUrl.replace(/\/+$/, '')}/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });
  if (!response.ok) {
    throw new Error(`拉取模型列表失败：接口返回 ${response.status}`);
  }
  const payload = (await response.json()) as { data?: Array<{ id?: string }> };
  return (payload.data ?? [])
    .map((item) => item.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .sort();
}

/* -------------------------------------------------------- 结构化解析 */

/** 从模型输出中截取 JSON，容忍常见的代码块包裹与前后缀说明。 */
export function extractJson<T>(raw: string): T | null {
  const text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence?.[1]?.trim() ?? text;

  const tryParse = (value: string): T | null => {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  };

  const direct = tryParse(candidate);
  if (direct !== null) return direct;

  const arrayStart = candidate.indexOf('[');
  const arrayEnd = candidate.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    const parsed = tryParse(candidate.slice(arrayStart, arrayEnd + 1));
    if (parsed !== null) return parsed;
  }
  const objectStart = candidate.indexOf('{');
  const objectEnd = candidate.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    const parsed = tryParse(candidate.slice(objectStart, objectEnd + 1));
    if (parsed !== null) return parsed;
  }
  return null;
}

/**
 * 组装一次任务调用所需的提示词。
 * 用户覆盖的模板优先于内置模板，按供应商维度生效。
 */
export function composePrompt(options: {
  taskType: TaskType;
  providerId?: string | null;
  vars: Record<string, string>;
  /** 用户自定义的系统提示词与用户提示词的追加内容 */
  overrideSystem?: string;
  overrideUser?: string;
  templateOverride?: { systemPrompt: string; userPrompt: string; temperature: number | null } | null;
  novelId?: string;
}): { messages: ChatMessage[]; temperature: number } {
  const builtin = getBuiltinPrompt(options.taskType);
  const template = options.templateOverride ?? null;
  const systemTemplate = template?.systemPrompt?.trim()
    ? template.systemPrompt
    : builtin.systemPrompt;
  const userTemplate = template?.userPrompt?.trim() ? template.userPrompt : builtin.userPrompt;

  const system = [renderTemplate(systemTemplate, options.vars), options.overrideSystem?.trim()]
    .filter(Boolean)
    .join('\n\n');
  const user = [renderTemplate(userTemplate, options.vars), options.overrideUser?.trim()]
    .filter(Boolean)
    .join('\n\n');

  let temperature = template?.temperature ?? builtin.temperature;
  if (options.novelId) {
    const preferences = getNovelPreferences(options.novelId);
    if (preferences.rules.allowExplicit === false && options.taskType === 'chapter') {
      // 不写性描写时降低发散度，减少越界概率
      temperature = Math.min(temperature, 0.95);
    }
  }

  return {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
  };
}
