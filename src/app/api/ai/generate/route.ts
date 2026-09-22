import { z } from 'zod';
import {
  getChapter,
  getNovel,
  saveChapterContent,
  updateChapter,
} from '@/lib/repo/novels';
import {
  createRun,
  getActiveProvider,
  getProvider,
  getPromptTemplate,
  recordUsage,
  updateRun,
} from '@/lib/repo/library';
import { getNovelPreferences } from '@/lib/repo/settings';
import {
  buildContext,
  findPreviousChapter,
  listEventChapters,
  lookupSettings,
} from '@/lib/ai/context';
import {
  MissingProviderError,
  chatOnce,
  chatStream,
  composePrompt,
  extractJson,
} from '@/lib/ai/client';
import {
  extractRecordList,
  getBuiltinPrompt,
  normalizeOptionList,
  parseModelDirectives,
  parseStepBlocks,
  parseStepStatus,
  stripStepBlocks,
} from '@/lib/ai/prompts';
import {
  advanceStoryEvent,
  createCharacter,
  createEncyclopediaEntry,
  createEncyclopediaQuery,
  createRecallRequest,
  createStoryEvent,
  createTimelineEvent,
  findCharacterByAlias,
  getCurrentStoryEvent,
  getMainBranch,
  getStoryEvent,
  listCharacters,
  listRecallRequests,
  listStoryEvents,
  resolveEncyclopediaQuery,
  updateStoryEvent,
} from '@/lib/repo/story';
import { listChapters } from '@/lib/repo/novels';
import type { CharacterRole, StoryEventStep, TaskType } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 生成请求的字段校验。 */
const generateSchema = z.object({
  novelId: z.string().min(1),
  chapterId: z.string().optional().nullable(),
  taskType: z.enum([
    'direction',
    'outline',
    'outline_revise',
    'chapter',
    'chapter_revise',
    'character_extract',
    'encyclopedia_extract',
    'free',
  ]),
  providerId: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  instruction: z.string().optional().nullable(),
  direction: z.string().optional().nullable(),
  optionCount: z.number().int().min(1).max(8).optional(),
  existingContent: z.string().optional().nullable(),
  revisionMode: z.string().optional().nullable(),
  pinnedChapterIds: z.array(z.string()).optional(),
  /** 当前工作的事件，缺省时取正在推进的事件 */
  eventId: z.string().optional().nullable(),
  /** 用户为本次事件选定的方向，写入事件记录供后续复盘 */
  userChoice: z.string().optional().nullable(),
  overrideSystem: z.string().optional().nullable(),
  overrideUser: z.string().optional().nullable(),
  /** 生成完成后写入章节正文 */
  saveToChapter: z.boolean().optional(),
  /** 生成完成后自动推进事件进度 */
  autoAdvanceEvent: z.boolean().optional(),
  /** 章末自动抽取新设定并写入百科与角色图鉴 */
  autoExtractSettings: z.boolean().optional(),
  /** 中断后继续生成时携带的已完成内容 */
  resumeFrom: z.string().optional().nullable(),
  resumeRunId: z.string().optional().nullable(),
  maxTokens: z.number().int().positive().optional(),
});

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * POST /api/ai/generate
 *
 * 以 Server-Sent Events 返回流式生成结果。
 * 事件序列：meta、delta 若干、可选的结构化结果事件、saved、event-outline、stage、advanced、usage、done。
 * 客户端中断连接时，已生成的内容会写入生成任务记录，可通过 resumeRunId 继续。
 */
export async function POST(request: Request): Promise<Response> {
  let parsed: z.infer<typeof generateSchema>;
  try {
    const raw = await request.json();
    parsed = generateSchema.parse(raw);
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? `请求参数不合法：${error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('；')}`
        : '请求体解析失败';
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const novel = getNovel(parsed.novelId);
  if (!novel) {
    return new Response(JSON.stringify({ error: '小说不存在' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let provider;
  try {
    provider = parsed.providerId ? getProvider(parsed.providerId) : getActiveProvider();
    if (!provider) throw new MissingProviderError();
  } catch (error) {
    const message = error instanceof Error ? error.message : '供应商配置有误';
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const chapter = parsed.chapterId ? getChapter(parsed.chapterId) : null;
  const preferences = getNovelPreferences(parsed.novelId);
  const taskType = parsed.taskType as TaskType;
  const builtin = getBuiltinPrompt(taskType);

  // 正文生成时先确认事件状态：事件未完成则继续推进，已完成则等待用户确认新方向
  const currentEvent = parsed.eventId
    ? getStoryEvent(parsed.eventId)
    : getCurrentStoryEvent(parsed.novelId);
  const isFirstChapter = listChapters(parsed.novelId).length === 0;

  // 已放行的事件调阅请求，决定本次是否注入往期事件的全部章节
  const approvedRecalls = listRecallRequests(parsed.novelId).filter((item) => item.approved);
  const recalledChapterIds = new Set<string>(parsed.pinnedChapterIds ?? []);
  for (const recall of approvedRecalls) {
    for (const item of listEventChapters(parsed.novelId, recall.eventId)) {
      recalledChapterIds.add(item.id);
    }
  }

  // 组装上下文
  const bundle = buildContext(parsed.novelId, {
    chapterId: parsed.chapterId ?? undefined,
    direction: parsed.direction ?? undefined,
    instruction: parsed.instruction ?? undefined,
    eventId: currentEvent?.id,
    pinnedChapterIds: Array.from(recalledChapterIds),
  });

  const vars: Record<string, string> = {
    ...bundle.vars,
    novelTitle: novel.title,
    genre: novel.genre,
    chapterTitle: chapter?.title ?? '',
    optionCount: String(parsed.optionCount ?? 3),
    existingContent: parsed.existingContent ?? '',
    instruction: [parsed.instruction ?? '', parsed.direction ?? ''].filter(Boolean).join('\n'),
    revisionMode: parsed.revisionMode ?? '按指令修改',
    currentEventOutline: parsed.existingContent?.trim() || bundle.vars.currentEventOutline || '',
  };

  const template = getPromptTemplate(taskType, provider.id);
  const composed = composePrompt({
    taskType,
    providerId: provider.id,
    vars,
    templateOverride: template
      ? {
          systemPrompt: template.systemPrompt,
          userPrompt: template.userPrompt,
          temperature: template.temperature,
        }
      : null,
    overrideSystem: parsed.overrideSystem ?? undefined,
    overrideUser: parsed.overrideUser ?? undefined,
    novelId: parsed.novelId,
  });

  const runId = createRun({
    novelId: parsed.novelId,
    chapterId: parsed.chapterId ?? null,
    taskType,
    providerId: provider.id,
    model: parsed.model || provider.defaultModel,
    request: { taskType, instruction: parsed.instruction },
  });

  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseEvent(event, data)));
      };

      send('meta', {
        runId,
        providerId: provider.id,
        providerName: provider.name,
        model: parsed.model || provider.defaultModel,
        taskType,
        taskLabel: builtin.label,
        contextTokens: bundle.totalTokens,
        budget: bundle.budget,
        layers: bundle.layers.map((layer) => ({
          key: layer.key,
          label: layer.label,
          tokens: layer.tokens,
          trimmed: layer.trimmed,
          always: layer.always,
        })),
        citations: bundle.citations,
        trimmed: bundle.trimmed,
        // 事件流程状态，界面据此决定展示方向选项还是正文工作台
        flow: {
          isFirstChapter,
          needsDirection: isFirstChapter || (!currentEvent && taskType === 'chapter'),
          event: currentEvent
            ? {
                id: currentEvent.id,
                title: currentEvent.title,
                novelTime: currentEvent.novelTime,
                progress: currentEvent.progress,
                stepCount: currentEvent.steps.length,
                status: currentEvent.status,
              }
            : null,
        },
      });

      // 客户端中断时用于保存已生成的内容
      let accumulated = parsed.resumeFrom ?? '';
      const abortController = new AbortController();
      request.signal.addEventListener('abort', () => abortController.abort());

      const messages = [...composed.messages];
      if (parsed.resumeFrom) {
        messages.push({ role: 'assistant', content: parsed.resumeFrom });
        messages.push({
          role: 'user',
          content: '上文已经生成了一部分，请从断点处自然接续，不要重复已有内容，直接继续输出后续正文。',
        });
      }

      let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimated: true };
      let failed = false;

      try {
        for await (const chunk of chatStream({
          messages,
          providerId: provider.id,
          model: parsed.model || provider.defaultModel,
          temperature: composed.temperature,
          maxTokens: parsed.maxTokens,
          responseFormat:
            builtin.outputFormat === 'json' ||
            builtin.outputFormat === 'options' ||
            builtin.outputFormat === 'outline'
              ? 'json'
              : 'text',
          signal: abortController.signal,
        })) {
          if (chunk.type === 'delta') {
            accumulated += chunk.text;
            send('delta', { text: chunk.text });
          } else if (chunk.type === 'usage') {
            usage = chunk.usage;
          } else if (chunk.type === 'error') {
            failed = true;
            updateRun(runId, { status: 'failed', partialText: accumulated, error: chunk.message });
            send('error', { message: chunk.message });
          } else if (chunk.type === 'done') {
            usage = chunk.usage;
            accumulated = chunk.text || accumulated;
          }
        }
      } catch (error) {
        if (abortController.signal.aborted) {
          updateRun(runId, { status: 'paused', partialText: accumulated });
          send('paused', { runId, partial: accumulated });
        } else {
          failed = true;
          const message = error instanceof Error ? error.message : '生成过程出现异常';
          updateRun(runId, { status: 'failed', partialText: accumulated, error: message });
          send('error', { message });
        }
      }

      if (abortController.signal.aborted) {
        controller.close();
        return;
      }

      const durationMs = Date.now() - startedAt;
      recordUsage({
        novelId: parsed.novelId,
        chapterId: parsed.chapterId ?? null,
        providerId: provider.id,
        providerName: provider.name,
        model: parsed.model || provider.defaultModel,
        taskType,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        estimated: usage.estimated,
        durationMs,
      });
      send('usage', { ...usage, durationMs, estimated: usage.estimated });
      updateRun(runId, { status: failed ? 'failed' : 'done', partialText: accumulated });

      if (failed) {
        send('done', { runId, length: accumulated.length, durationMs });
        controller.close();
        return;
      }

      // 剥离模型提出的查询与调阅标记，正文只保留成品内容
      const directives = parseModelDirectives(accumulated);
      accumulated = directives.clean;

      // 记录模型提出的设定查询请求
      if (directives.queries.length > 0) {
        const recorded = directives.queries.map((keyword) => {
          const query = createEncyclopediaQuery(parsed.novelId, {
            keyword,
            eventId: currentEvent?.id ?? null,
            reason: '模型在生成过程中提出的设定查询',
          });
          // 立即把已有条目回填，避免用户手工重复操作
          const filled = fillQueryFromLibrary(parsed.novelId, query.id, keyword);
          return { id: query.id, keyword, filled };
        });
        send('queries', { queries: recorded });
      }

      // 记录模型提出的往期事件调阅请求，等待用户放行
      if (directives.recalls.length > 0 && preferences.allowEventRecall) {
        const events = listStoryEvents(parsed.novelId);
        const requested = directives.recalls
          .map((item) => {
            const matched = events.find((event) => event.title === item.event);
            if (!matched) return null;
            const request = createRecallRequest(parsed.novelId, {
              eventId: matched.id,
              reason: item.reason,
            });
            return { id: request.id, eventId: matched.id, eventTitle: matched.title, reason: item.reason };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null);
        if (requested.length > 0) send('recalls', { requests: requested });
      }

      // 结构化任务：把模型输出解析成 JSON 一并回传，界面无需重复解析
      if (builtin.outputFormat === 'json' || builtin.outputFormat === 'options') {
        const parsedJson = extractJson<unknown>(accumulated);
        if (parsedJson === null) {
          send('error', { message: '模型没有返回可解析的结构化结果，请重试或改用更稳定的模型' });
        } else if (builtin.outputFormat === 'options') {
          // 方向选项统一归一成数组。模型在 JSON 模式下常把数组再包一层，
          // 直接透传会让界面拿到的不是数组，表现为一条选项都显示不出来。
          const options = normalizeOptionList(parsedJson);
          if (options.length === 0) {
            send('error', { message: '模型返回的方向选项为空，请重试或改用更稳定的模型' });
          } else {
            send('json', { taskType, data: options });
          }
        } else {
          send('json', { taskType, data: parsedJson });
        }
      }

      // 事件大纲：解析为 Markdown 正文加步骤清单，落库为新的故事事件
      if (taskType === 'outline' || taskType === 'outline_revise') {
        const steps = parseStepBlocks(accumulated);
        const outlineMarkdown = stripStepBlocks(accumulated).trim();
        if (steps.length === 0) {
          send('error', { message: '大纲缺少步骤清单，无法建立事件推进节点，请重试' });
        } else {
          const stepPayload: StoryEventStep[] = steps.map((step) => ({
            title: step.title,
            detail: '',
            novelTime: step.time || undefined,
          }));
          const title = extractOutlineTitle(outlineMarkdown) || `事件 ${steps.length} 步`;

          if (taskType === 'outline_revise' && currentEvent) {
            const updated = updateEventOutline(
              currentEvent.id,
              title,
              outlineMarkdown,
              stepPayload,
            );
            send('event-outline', {
              eventId: currentEvent.id,
              mode: 'revised',
              title: updated?.title ?? title,
              outline: outlineMarkdown,
              novelTime: updated?.novelTime ?? currentEvent.novelTime,
              steps: updated?.steps ?? stepPayload,
              progress: updated?.progress ?? 0,
            });
          } else {
            const firstStep = stepPayload[0];
            const created = createStoryEvent(parsed.novelId, {
              title,
              outline: outlineMarkdown,
              steps: stepPayload,
              novelTime: firstStep?.novelTime ?? '',
              timeSort: firstStep?.novelTime ?? '',
              userChoice: parsed.userChoice ?? parsed.direction ?? '',
              volumeId: chapter?.volumeId ?? null,
            });
            send('event-outline', {
              eventId: created.id,
              mode: 'created',
              title: created.title,
              outline: created.outline,
              novelTime: created.novelTime,
              steps: created.steps,
              progress: created.progress,
              timelineEventId: created.timelineEventId,
            });
          }
        }
      }

      // 正文写入章节
      let savedWordCount = 0;
      if (parsed.saveToChapter && parsed.chapterId && accumulated.trim()) {
        const cleaned = accumulated.trim();
        saveChapterContent(parsed.chapterId, cleaned, { markGenerated: true });
        const saved = getChapter(parsed.chapterId);
        savedWordCount = saved?.wordCount ?? 0;
        send('saved', { chapterId: parsed.chapterId, wordCount: savedWordCount });
      }

      // 事件推进：依据模型给出的步骤完成标记移动进度指针
      const shouldAdvance =
        parsed.autoAdvanceEvent ??
        (preferences.autoAdvanceEvent &&
          (taskType === 'chapter' || taskType === 'chapter_revise') &&
          currentEvent !== null);

      if (shouldAdvance && currentEvent) {
        const status = parseStepStatus(accumulated);
        if (status.value === 'done') {
          const advanced = advanceStoryEvent(currentEvent.id, 1);
          if (advanced) {
            send('advanced', {
              eventId: advanced.id,
              progress: advanced.progress,
              stepCount: advanced.steps.length,
              status: advanced.status,
              completed: advanced.status === 'done',
              // 事件结束意味着需要再次向用户询问故事方向
              needsDirection: advanced.status === 'done',
            });
            if (parsed.chapterId) {
              updateChapter(parsed.chapterId, {
                eventId: advanced.id,
                stepIndex: advanced.progress,
                timelineSort: advanced.timeSort,
              });
            }
          }
        } else {
          send('advanced', {
            eventId: currentEvent.id,
            progress: currentEvent.progress,
            stepCount: currentEvent.steps.length,
            status: currentEvent.status,
            completed: false,
            needsDirection: false,
            partial: status.remainder,
          });
        }
      }

      // 章末抽取新设定：写入百科与角色图鉴
      const shouldExtract =
        parsed.autoExtractSettings ??
        (preferences.autoExtractSettings && (taskType === 'chapter' || taskType === 'chapter_revise'));

      if (shouldExtract && parsed.chapterId && accumulated.trim()) {
        try {
          send('stage', { stage: 'extract', message: '正在整理本章出现的新设定' });
          const created = await extractNewSettings({
            novelId: parsed.novelId,
            chapterId: parsed.chapterId,
            chapterTitle: chapter?.title ?? '未命名章节',
            content: accumulated,
            providerId: provider.id,
            model: parsed.model || provider.defaultModel,
            baseVars: bundle.vars,
            startedAt,
            providerName: provider.name,
          });
          if (created.entries > 0 || created.characters > 0) {
            send('extracted', created);
          }
        } catch (error) {
          send('error', {
            message: `正文已保存，但新设定整理失败：${error instanceof Error ? error.message : '未知原因'}`,
          });
        }
      }

      send('done', { runId, length: accumulated.length, durationMs });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

/** 从大纲 Markdown 的一级标题中取事件名。 */
function extractOutlineTitle(markdown: string): string {
  const match = /^#\s+(.+)$/m.exec(markdown);
  if (match?.[1]) return match[1].trim();
  const firstLine = markdown.split('\n').find((line) => line.trim());
  return firstLine ? firstLine.replace(/^#+\s*/, '').trim() : '';
}

/**
 * 用已有的百科与角色图鉴填充一条查询请求。
 *
 * 命中时立即标记为已解决，模型下一轮就能拿到结果，用户无需先做一次手工确认。
 */
function fillQueryFromLibrary(novelId: string, queryId: string, keyword: string): boolean {
  const hits = lookupSettings(novelId, [keyword]);
  if (hits.length === 0) return false;
  const text = hits
    .slice(0, 6)
    .map((hit) => `### [${hit.entry.category}] ${hit.entry.name}\n${hit.entry.content || hit.entry.summary}`)
    .join('\n\n');
  resolveEncyclopediaQuery(queryId, text);
  return true;
}

/** 更新事件大纲，步骤缩减时进度指针由仓储层自动夹取。 */
function updateEventOutline(
  eventId: string,
  title: string,
  outline: string,
  steps: StoryEventStep[],
) {
  return updateStoryEvent(eventId, { title, outline, steps });
}

/**
 * 章末新设定整理。
 *
 * 一次请求同时抽取百科条目与角色条目，减少往返。
 * 新角色的发言色相由模型根据身份给出，落库前与已有色相做一次避让。
 */
async function extractNewSettings(params: {
  novelId: string;
  chapterId: string;
  chapterTitle: string;
  content: string;
  providerId: string;
  model: string;
  baseVars: Record<string, string>;
  startedAt: number;
  providerName: string;
}): Promise<{ entries: number; characters: number; names: string[] }> {
  const {
    novelId,
    chapterId,
    chapterTitle,
    content,
    providerId,
    model,
    baseVars,
    startedAt,
    providerName,
  } = params;

  const existing = listCharacters(novelId);
  const palette = existing.map((item) => `${item.name}｜色相 ${item.speechHue}`).join('\n') || '暂无';

  const encyclopediaPrompt = composePrompt({
    taskType: 'encyclopedia_extract',
    providerId,
    vars: {
      ...baseVars,
      currentEventOutline: baseVars.currentEventOutline ?? '',
      existingContent: content,
      encyclopediaIndex: baseVars.encyclopediaIndex ?? '',
    },
    novelId,
  });
  const encyclopediaResult = await chatOnce({
    messages: encyclopediaPrompt.messages,
    providerId,
    model,
    temperature: encyclopediaPrompt.temperature,
    responseFormat: 'json',
  });
  recordUsage({
    novelId,
    chapterId,
    providerId,
    providerName,
    model,
    taskType: 'encyclopedia_extract',
    promptTokens: encyclopediaResult.usage.promptTokens,
    completionTokens: encyclopediaResult.usage.completionTokens,
    totalTokens: encyclopediaResult.usage.totalTokens,
    estimated: encyclopediaResult.usage.estimated,
    durationMs: Date.now() - startedAt,
  });

  let entryCount = 0;
  // 模型常把数组包在 entries 或 items 里，统一下钻取出，避免整批条目被丢弃
  const entryJson = extractRecordList(
    extractJson<unknown>(encyclopediaResult.text),
    ['entries', 'encyclopedia', 'items', 'list', 'data', 'results'],
  );
  for (const raw of entryJson) {
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name) continue;
    createEncyclopediaEntry(novelId, {
      category: typeof raw.category === 'string' ? raw.category : '其他',
      name,
      aliases: typeof raw.aliases === 'string' ? raw.aliases : '',
      summary: typeof raw.summary === 'string' ? raw.summary : '',
      content: typeof raw.content === 'string' ? raw.content : '',
      tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === 'string') : [],
      sourceChapterId: chapterId,
    });
    entryCount += 1;
  }

  const characterPrompt = composePrompt({
    taskType: 'character_extract',
    providerId,
    vars: {
      ...baseVars,
      currentEventOutline: baseVars.currentEventOutline ?? '',
      existingContent: content,
      characters: palette,
      chapterTitle,
    },
    novelId,
  });
  const characterResult = await chatOnce({
    messages: characterPrompt.messages,
    providerId,
    model,
    temperature: characterPrompt.temperature,
    responseFormat: 'json',
  });
  recordUsage({
    novelId,
    chapterId,
    providerId,
    providerName,
    model,
    taskType: 'character_extract',
    promptTokens: characterResult.usage.promptTokens,
    completionTokens: characterResult.usage.completionTokens,
    totalTokens: characterResult.usage.totalTokens,
    estimated: characterResult.usage.estimated,
    durationMs: Date.now() - startedAt,
  });

  let characterCount = 0;
  const names: string[] = [];
  const characterList = extractRecordList(
    extractJson<unknown>(characterResult.text),
    ['characters', 'roles', 'items', 'list', 'data'],
  );
  for (const raw of characterList) {
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name) continue;
    // 已登记的角色不再重复创建，避免同一个人出现多条图鉴
    if (findCharacterByAlias(novelId, name)) continue;
    const rawHue = typeof raw.speechHue === 'number' ? raw.speechHue : undefined;
    createCharacter(novelId, {
      name,
      aliases: Array.isArray(raw.aliases)
        ? raw.aliases.filter((item): item is string => typeof item === 'string')
        : [],
      emoji: typeof raw.emoji === 'string' ? raw.emoji : '🙂',
      roleType: resolveRoleType(raw.roleType),
      gender: typeof raw.gender === 'string' ? raw.gender : '',
      age: typeof raw.age === 'string' ? raw.age : '',
      faction: typeof raw.faction === 'string' ? raw.faction : '',
      personality: typeof raw.personality === 'string' ? raw.personality : '',
      appearance: typeof raw.appearance === 'string' ? raw.appearance : '',
      ability: typeof raw.ability === 'string' ? raw.ability : '',
      background: typeof raw.background === 'string' ? raw.background : '',
      arc: typeof raw.arc === 'string' ? raw.arc : '',
      notes: typeof raw.speechHueReason === 'string' ? `发言色选择理由：${raw.speechHueReason}` : '',
      speechHue: rawHue,
      speechColorMode: 'auto',
    });
    characterCount += 1;
    names.push(name);
  }

  return { entries: entryCount, characters: characterCount, names };
}

/** 把模型给出的角色定位收敛到内置枚举，未知取值回落到配角。 */
function resolveRoleType(value: unknown): CharacterRole {
  const allowed: CharacterRole[] = ['protagonist', 'supporting', 'antagonist', 'minor', 'extra'];
  return typeof value === 'string' && allowed.includes(value as CharacterRole)
    ? (value as CharacterRole)
    : 'supporting';
}

export { findPreviousChapter, createTimelineEvent, getMainBranch };
