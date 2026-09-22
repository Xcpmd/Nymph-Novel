import { asString, handle, readBody } from '@/lib/api/http';
import { deletePromptTemplate, getPromptTemplate, listPromptTemplates, upsertPromptTemplate } from '@/lib/repo/library';
import { BUILTIN_PROMPTS, extractPlaceholders, getBuiltinPrompt } from '@/lib/ai/prompts';
import type { TaskType } from '@/lib/types';

const TASK_TYPES: TaskType[] = [
  'direction',
  'outline',
  'outline_revise',
  'chapter',
  'chapter_revise',
  'character_extract',
  'encyclopedia_extract',
  'free',
];

/**
 * GET /api/prompts?providerId=xxx
 * 返回内置模板、该供应商下的自定义覆盖，以及每个模板可用的变量清单。
 */
export async function GET(request: Request) {
  return handle(() => {
    const url = new URL(request.url);
    const providerId = url.searchParams.get('providerId') || null;
    const overrides = listPromptTemplates(providerId);

    return {
      builtin: BUILTIN_PROMPTS.map((prompt) => ({
        ...prompt,
        effective: overrides.find((item) => item.taskType === prompt.taskType) ?? null,
        placeholders: Array.from(
          new Set([
            ...extractPlaceholders(prompt.systemPrompt),
            ...extractPlaceholders(prompt.userPrompt),
          ]),
        ).sort(),
      })),
      overrides,
      taskTypes: TASK_TYPES,
    };
  });
}

/** POST /api/prompts 写入或覆盖提示词模板。 */
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readBody(request);
    const taskType = asString(body.taskType) as TaskType | undefined;
    if (!taskType || !TASK_TYPES.includes(taskType)) throw new Error('任务类型不合法');

    const providerId = asString(body.providerId) || null;
    const builtin = getBuiltinPrompt(taskType);

    const template = upsertPromptTemplate({
      taskType,
      providerId,
      systemPrompt: asString(body.systemPrompt) ?? builtin.systemPrompt,
      userPrompt: asString(body.userPrompt) ?? builtin.userPrompt,
      temperature: body.temperature === undefined || body.temperature === null
        ? null
        : Number(body.temperature),
    });
    return { template, overrides: listPromptTemplates(providerId) };
  });
}

/** DELETE /api/prompts?taskType=xxx&providerId=yyy 删除覆盖，回退到内置模板。 */
export async function DELETE(request: Request) {
  return handle(() => {
    const url = new URL(request.url);
    const taskType = url.searchParams.get('taskType') as TaskType | null;
    const providerId = url.searchParams.get('providerId') || null;
    if (!taskType) throw new Error('缺少任务类型参数');
    deletePromptTemplate(taskType, providerId);
    return { ok: true, removed: getPromptTemplate(taskType, providerId) === null };
  });
}
