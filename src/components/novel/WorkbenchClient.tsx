'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, formatNumber, novelResourcePath } from '@/lib/client/api';
import { useSettings } from '@/components/providers/SettingsProvider';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/Modal';
import {
  Button,
  Field,
  Panel,
  ProgressBar,
  Select,
  Spinner,
  TextArea,
  TextInput,
} from '@/components/ui/primitives';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { ContextInspector } from './ContextInspector';
import { BudgetConfirmPrompt } from './BudgetConfirmPrompt';
import { useGeneration } from '@/hooks/useGeneration';
import { useDraftState } from '@/hooks/useDraftState';
import { normalizeOptionList, parseStepStatus } from '@/lib/ai/prompts';
import { buildSpeakerColors } from '@/lib/markdown/speakers';
import { deriveStepsFromOutline } from '@/lib/markdown/outline';
import { countWords } from '@/lib/token';
import { stripWalkMarkers } from '@/lib/markdown/talk';
import type {
  ChapterWithVolume,
  Character,
  NovelPreferences,
  Provider,
  StoryEvent,
  StoryEventListPayload,
} from '@/lib/types';

/**
 * 创作工作台。
 *
 * 按事件大纲流程组织：
 * 第一步确认故事发展方向，第二步生成并确认事件大纲，第三步逐章推进直到事件收束，
 * 事件完成后回到第一步再次询问方向。界线上只保留必要的手工干预点。
 */

interface DirectionOption {
  title: string;
  summary: string;
  tone?: string;
  risk?: string;
}

const STEPS = [
  { key: 'direction', labelKey: 'workbench.stepDirection', icon: 'fa-solid fa-compass' },
  { key: 'outline', labelKey: 'workbench.stepOutline', icon: 'fa-solid fa-diagram-project' },
  { key: 'chapter', labelKey: 'workbench.stepChapter', icon: 'fa-solid fa-pen-nib' },
  { key: 'progress', labelKey: 'workbench.stepProgress', icon: 'fa-solid fa-flag-checkered' },
] as const;

type StepKey = (typeof STEPS)[number]['key'];

export function WorkbenchClient({ novelId }: { novelId: string }) {
  const { t, settings, update } = useSettings();
  const toast = useToast();
  const generation = useGeneration();

  const [providers, setProviders] = useState<Provider[]>([]);
  const [preferences, setPreferences] = useState<NovelPreferences | null>(null);
  const [chapters, setChapters] = useState<ChapterWithVolume[]>([]);
  const [currentEvent, setCurrentEvent] = useState<StoryEvent | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  /** 可选的上下文层清单，来自服务端定义 */
  const [layerCatalog, setLayerCatalog] = useState<
    Array<{ key: string; label: string; note: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<StepKey>('direction');

  /*
   * 用户输入的部分做本地缓存。
   *
   * 切到别的页面再回来，组件会重新挂载，普通 state 里的输入就没了。
   * 大纲草稿不在此列——它已经防抖落库，重新加载时会从事件里读回来。
   */
  const [customDirection, setCustomDirection] = useDraftState(
    `${novelId}:workbench:direction`,
    '',
  );
  const [selectedDirection, setSelectedDirection] = useState('');
  const [additionalInstruction, setAdditionalInstruction] = useDraftState(
    `${novelId}:workbench:instruction`,
    '',
  );
  const [chapterId, setChapterId] = useState('');
  const [newChapterTitle, setNewChapterTitle] = useDraftState(
    `${novelId}:workbench:new-chapter`,
    '',
  );
  const [outlineReviseAsk, setOutlineReviseAsk, clearOutlineReviseAsk] = useDraftState(
    `${novelId}:workbench:revise-ask`,
    '',
  );
  /** 大纲草稿，用户可直接编辑 */
  const [outlineDraft, setOutlineDraft] = useState('');
  /** 大纲历史，每次 AI 改写或手动大改前压入，供随时撤回 */
  const [outlineHistory, setOutlineHistory] = useState<string[]>([]);
  const [outlineSaving, setOutlineSaving] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);
  /** 被用户主动丢弃的那一段生成结果。新的生成产生不同文本时会自动恢复显示。 */
  const [discardedText, setDiscardedText] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [
        chapterList,
        preferenceResult,
        providerResult,
        eventResult,
        characterResult,
        layerResult,
      ] = await Promise.all([
        api.get<ChapterWithVolume[]>(novelResourcePath(novelId, 'chapters')),
        api.get<{ preferences: NovelPreferences }>(novelResourcePath(novelId, 'preferences')),
        api.get<{ providers: Provider[] }>('/api/providers'),
        api.get<StoryEventListPayload>(novelResourcePath(novelId, 'story-events')),
        api.get<Character[]>(novelResourcePath(novelId, 'characters')),
        // 上下文层清单由服务端定义，界面只负责展示与勾选
        api.get<{ layers: Array<{ key: string; label: string; note: string }> }>(
          novelResourcePath(novelId, 'context-layers'),
        ),
      ]);
      setChapters(chapterList);
      setPreferences(preferenceResult.preferences);
      setProviders(providerResult.providers);
      setCurrentEvent(eventResult.current);
      setCharacters(characterResult);
      setLayerCatalog(layerResult.layers ?? []);

      // 进入工作台时按当前状态自动落到合适的步骤
      const requested = new URLSearchParams(window.location.search).get('chapterId');
      if (requested && chapterList.some((chapter) => chapter.id === requested)) {
        setChapterId(requested);
        setStep('chapter');
      } else {
        const firstPlanned = chapterList.find(
          (chapter) => chapter.status === 'planned' || chapter.wordCount === 0,
        );
        setChapterId(firstPlanned?.id ?? chapterList[chapterList.length - 1]?.id ?? '');
        if (!eventResult.current) setStep('direction');
        else if (eventResult.current.progress === 0) setStep('outline');
        else setStep('chapter');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    } finally {
      setLoading(false);
    }
  }, [novelId, t, toast]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novelId]);

  // 生成结果直接作为输出内容，被主动丢弃的那一段不再显示
  const output = generation.text === discardedText ? '' : generation.text;
  // 正文里不含步骤区块与查询标记，展示前统一剥除
  const cleanOutput = useMemo(() => stripWalkMarkers(output), [output]);

  /**
   * 本次生成结果是否属于正文任务。
   *
   * 各步骤共用同一个生成钩子，第二步产出的大纲会留在 text 里，
   * 切到第三步时若不区分，大纲就会出现在正文区，字数统计也跟着算错。
   */
  const isChapterOutput =
    generation.meta?.taskType === 'chapter' || generation.meta?.taskType === 'chapter_revise';
  /** 只取正文任务的输出，供第三步的预览与字数使用 */
  const chapterOutput = isChapterOutput ? cleanOutput : '';

  const activeProvider = useMemo(
    () => providers.find((provider) => provider.isActive) ?? providers[0],
    [providers],
  );

  /** 角色发言配色表，取自角色图鉴，生成预览里的对白按它染色 */
  const speakerColors = useMemo(() => buildSpeakerColors(characters), [characters]);

  const target = preferences?.targetWords ?? 3000;
  const currentWords = countWords(chapterOutput);

  /**
   * 方向选项。
   *
   * 服务端已经把模型输出归一成数组，这里仍然再走一遍归一化，
   * 因为早期生成的记录、以及自定义提示词返回的其他包裹形式都可能绕过服务端的处理。
   */
  const directionOptions = useMemo<DirectionOption[]>(() => {
    if (!generation.structured) return [];
    return normalizeOptionList(generation.structured).map((item) => ({
      title: item.title || '未命名方向',
      summary: item.summary,
      tone: item.tone,
      risk: item.risk,
    }));
  }, [generation.structured]);

  // 事件大纲生成后会落到 generation.eventOutline，同时刷新事件状态
  const activeEvent = generation.eventOutline
    ? {
        id: generation.eventOutline.eventId,
        title: generation.eventOutline.title,
        outline: generation.eventOutline.outline,
        steps: generation.eventOutline.steps,
        progress: generation.eventOutline.progress,
        novelTime: generation.eventOutline.novelTime,
      }
    : currentEvent;

  const generateDirections = async () => {
    setStep('direction');
    await generation.start({
      novelId,
      taskType: 'direction',
      instruction: additionalInstruction,
      optionCount: 3,
    });
  };

  /**
   * 大纲的编辑、保存与撤回。
   *
   * 大纲原先只能整体重新生成，改一句话也要重跑一次。
   * 现在正文可改，改完防抖落库；AI 改写前把当前版本压入历史，
   * 不满意随时退回上一版。
   *
   * 历史只放在内存里：够覆盖一次调整回合，刷新后作废。
   * 真正需要长期留档的内容走事件页的版本概念，不在这里堆。
   */
  const outlineSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /*
   * 卸载时的补发要用到最新值，但清理函数只建立一次，
   * 捕获不到后续渲染里的变量，因此用 ref 转一手。
   */
  const pendingOutlineRef = useRef<{ eventId: string; text: string } | null>(null);
  useEffect(() => {
    pendingOutlineRef.current = activeEvent
      ? { eventId: activeEvent.id, text: outlineDraft }
      : null;
    // activeEvent 每次渲染都是新对象，只跟 id 走
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEvent?.id, outlineDraft]);

  const persistOutline = useCallback(
    async (text: string, eventId: string) => {
      setOutlineSaving(true);
      try {
        await api.patch(novelResourcePath(novelId, 'story-events', eventId), { outline: text });
        setCurrentEvent((current) => (current?.id === eventId ? { ...current, outline: text } : current));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
      } finally {
        setOutlineSaving(false);
      }
    },
    [novelId, t, toast],
  );

  const onOutlineChange = (value: string) => {
    setOutlineDraft(value);
    if (!activeEvent) return;
    if (outlineSaveTimer.current) clearTimeout(outlineSaveTimer.current);
    outlineSaveTimer.current = setTimeout(() => void persistOutline(value, activeEvent.id), 800);
  };

  /** 撤回上一版大纲。 */
  const undoOutline = async () => {
    if (outlineHistory.length === 0 || !activeEvent) return;
    const [previous, ...rest] = outlineHistory;
    setOutlineHistory(rest);
    setOutlineDraft(previous);
    await persistOutline(previous, activeEvent.id);
  };

  /** 当前大纲能切出多少章，实时反映在预览里。 */
  const draftSteps = useMemo(() => deriveStepsFromOutline(outlineDraft), [outlineDraft]);

  /*
   * 切换事件时重置草稿与历史。
   *
   * 刻意只依赖 id 而不依赖 outline 内容：草稿是用户的输入目标，
   * 若跟着 outline 走，用户每敲一个字都会被库里的旧值覆盖回去。
   * AI 改写后的同步交给下面那个 effect 处理。
   */
  useEffect(() => {
    setOutlineDraft(activeEvent?.outline ?? '');
    setOutlineHistory([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEvent?.id]);

  // AI 改写完成后把新大纲同步进草稿，事件 id 不变，上面的 effect 不会触发
  useEffect(() => {
    if (generation.eventOutline?.outline) setOutlineDraft(generation.eventOutline.outline);
  }, [generation.eventOutline]);

  /*
   * 离开页面时把还没落库的大纲改动补发一次。
   *
   * 只清定时器是不够的：用户在防抖窗口内切走，这次编辑就丢了，
   * 而界面看不出任何异常。
   */
  useEffect(
    () => () => {
      if (!outlineSaveTimer.current) return;
      clearTimeout(outlineSaveTimer.current);
      const pending = pendingOutlineRef.current;
      if (pending) void persistOutline(pending.text, pending.eventId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * 保存参与提示词的上下文层与顺序。
   *
   * 立即落库而不是等统一保存：这个选择会影响下一次生成，
   * 用户勾完往往直接就去点生成了。
   */
  const saveContextLayers = useCallback(
    async (keys: string[]) => {
      setPreferences((current) => (current ? { ...current, contextLayers: keys } : current));
      try {
        await api.patch(novelResourcePath(novelId, 'preferences'), { contextLayers: keys });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
      }
    },
    [novelId, t, toast],
  );

  /**
   * 确认方向，进入第二步检视并修改故事大纲。
   *
   * 手写与 AI 给出的方向走同一条路径，都要经过大纲这一步。
   * 手写内容不再直接建成事件，否则会绕开大纲，后续推进就少了骨架。
   */
  const confirmDirection = () => {
    setStep('outline');
  };

  const generateOutline = async () => {
    setStep('outline');
    await generation.start({
      novelId,
      taskType: 'outline',
      direction: selectedDirection || customDirection,
      instruction: additionalInstruction,
      userChoice: selectedDirection || customDirection,
    });
  };

  const reviseOutline = async () => {
    if (!outlineReviseAsk.trim()) {
      toast.error(t('common.required'));
      return;
    }
    if (!activeEvent) {
      toast.error(t('workbench.noEventForRevise'));
      return;
    }
    const current = outlineDraft || activeEvent.outline;
    // 改写前留一份当前版本，改坏了可以退回
    setOutlineHistory((history) => [current, ...history].slice(0, 12));
    setStep('outline');
    await generation.start({
      novelId,
      taskType: 'outline_revise',
      instruction: outlineReviseAsk,
      eventId: activeEvent.id,
      // 送过去的是用户手上这一版，而不是库里的旧值
      existingContent: current,
    });
    // 要求已经送出去，清掉草稿，免得下次进来又看到上一次的输入
    clearOutlineReviseAsk();
  };
  /**
   * 把手写的大纲存成事件。
   *
   * 走到这一步时还没有任何事件，用户在这个输入框里从头写一份大纲，
   * 保存后推进步骤由服务端从文本推导，后续流程与 AI 生成的大纲完全一致。
   */
  const saveDraftAsEvent = async () => {
    const text = outlineDraft.trim();
    if (!text) {
      toast.error(t('events.outlineRequired'));
      return;
    }
    setOutlineSaving(true);
    try {
      const result = await api.post<{ event: StoryEvent }>(
        novelResourcePath(novelId, 'story-events'),
        { outline: text },
      );
      setCurrentEvent(result.event);
      setOutlineDraft(result.event.outline ?? text);
      toast.success(t('workbench.outlineSaved'));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    } finally {
      setOutlineSaving(false);
    }
  };

  /**
   * 按当前事件大纲拆分章节目录。
   *
   * 大纲的每个推进步骤对应一章，一次性建好，后续逐章生成时直接取用。
   * 已经建过的步骤由服务端跳过，重复点击不会产生重复章节。
   */
  const splitChapters = async () => {
    if (!activeEvent) return;
    try {
      const result = await api.patch<{ created: number; chapters: ChapterWithVolume[] }>(
        novelResourcePath(novelId, 'story-events', activeEvent.id),
        { action: 'splitChapters' },
      );
      setChapters(result.chapters);
      toast.success(t('workbench.splitDone').replace('{count}', String(result.created)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  const createChapterIfNeeded = async (): Promise<string | null> => {
    if (chapterId) return chapterId;
    if (!newChapterTitle.trim()) {
      toast.error(t('common.required'));
      return null;
    }
    try {
      // 章节落在用户选中的那一步上，而不是死跟事件进度
      const nextStepIndex = activeEvent ? effectiveStepIndex : undefined;
      const result = await api.post<{ chapter: ChapterWithVolume }>(
        novelResourcePath(novelId, 'chapters'),
        {
          title: newChapterTitle,
          direction: selectedDirection || customDirection,
          eventId: activeEvent?.id,
          stepIndex: nextStepIndex,
        },
      );
      setChapters((current) => [...current, result.chapter]);
      setChapterId(result.chapter.id);
      setNewChapterTitle('');
      return result.chapter.id;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
      return null;
    }
  };

  /*
   * 本次要写的步骤。
   *
   * null 表示跟随事件进度。允许单独指定是为了补写与跳写：
   * 回头补第 2 步，或先把高潮那一步写出来，都不必改动事件进度。
   */
  const [focusStep, setFocusStep] = useState<number | null>(null);
  // 切换事件时回到跟随进度
  useEffect(() => {
    setFocusStep(null);
  }, [activeEvent?.id]);

  /** 实际用于生成的步骤序号 */
  const effectiveStepIndex = focusStep ?? activeEvent?.progress ?? 0;

  const generateChapter = async () => {
    const id = await createChapterIfNeeded();
    if (!id) return;
    setStep('chapter');
    await generation.start({
      novelId,
      chapterId: id,
      taskType: 'chapter',
      direction: selectedDirection || customDirection,
      instruction: additionalInstruction,
      eventId: activeEvent?.id ?? null,
      // 服务端按这个序号决定本次写哪一步
      stepIndex: activeEvent ? effectiveStepIndex : undefined,
      /*
       * 只有写的正是进度所在那一步时才推进事件。
       * 回头补写或提前跳写都不该改动进度，否则后面几步会被当作已完成跳过。
       */
      autoAdvanceEvent:
        (preferences?.autoAdvanceEvent ?? true) &&
        (!activeEvent || activeEvent.progress === effectiveStepIndex),
      autoExtractSettings: preferences?.autoExtractSettings ?? true,
    });
  };

  /*
   * 计划性连续生成。
   *
   * 逐章串行推进：每章生成完先落库，再读回最新的章节列表与事件进度，
   * 用下一章作为新的目标重新发起一次生成。
   *
   * 必须串行而不能并发，原因是后续章节依赖前面章节的正文与推进后的进度：
   * 并发发出时每一章拿到的都是同一份旧上下文，「上一章正文」这一层会指向同一章，
   * 写出来的内容会互相重叠。
   */
  const planAbortRef = useRef(false);
  const [planCount, setPlanCount] = useState(3);
  const [planProgress, setPlanProgress] = useState<{ done: number; total: number } | null>(null);

  /**
   * 取章节正文写入章节，供连续生成在每章结束后落库。
   *
   * 与手工保存走同一接口，但这里不做确认弹窗，也不清空生成结果，
   * 下一轮生成开始时会由生成钩子自行重置。
   */
  const persistChapterOutput = useCallback(
    async (targetChapterId: string, content: string) => {
      await api.patch(novelResourcePath(novelId, 'chapters', targetChapterId), {
        content,
        markGenerated: true,
      });
    },
    [novelId],
  );

  /**
   * 连续生成到指定章数。
   *
   * 每一轮都重新读一遍事件与章节，确保「上一章正文」层指向的是刚写好的那一章。
   */
  const generatePlan = async () => {
    if (!activeEvent) {
      toast.error(t('workbench.noEventHint'));
      return;
    }
    const total = Math.max(1, Math.min(50, planCount));
    planAbortRef.current = false;
    setPlanProgress({ done: 0, total });
    setStep('chapter');

    // 本轮连续生成固定推进同一个事件，步骤序号逐轮更新
    const currentEventId = activeEvent.id;
    let currentStepIndex = effectiveStepIndex;

    try {
      for (let index = 0; index < total; index += 1) {
        if (planAbortRef.current) break;

        // 每轮都建一章，避免把整轮结果写进同一章
        const chapter = await api.post<{ chapter: ChapterWithVolume }>(
          novelResourcePath(novelId, 'chapters'),
          {
            title: '',
            direction: selectedDirection || customDirection,
            eventId: currentEventId,
            stepIndex: currentStepIndex,
          },
        );
        const targetId = chapter.chapter.id;
        setChapters((current) => [...current, chapter.chapter]);
        setChapterId(targetId);

        const result = await generation.start({
          novelId,
          chapterId: targetId,
          taskType: 'chapter',
          direction: selectedDirection || customDirection,
          instruction: additionalInstruction,
          eventId: currentEventId,
          stepIndex: currentStepIndex,
          // 连续生成时进度由下面统一推进，不让单次生成各自改动
          autoAdvanceEvent: false,
          autoExtractSettings: false,
        });

        if (result.error) break;

        const produced = result.text.trim();
        if (!produced) {
          toast.error(t('workbench.planEmptyChapter'));
          break;
        }

        await persistChapterOutput(targetId, produced);
        setPlanProgress({ done: index + 1, total });

        /*
         * 推进事件进度并取回最新状态。
         *
         * 这一步决定下一章写的是第几步；不推进的话每章都会重写同一个步骤。
         */
        const stepStatus = parseStepStatus(produced);
        if (stepStatus.value === 'done') {
          const advanced = await api.patch<{ event: StoryEvent }>(
            novelResourcePath(novelId, 'story-events', currentEventId),
            { advance: 1 },
          );
          setCurrentEvent(advanced.event);
          currentStepIndex = advanced.event.progress;
          if (advanced.event.progress >= advanced.event.steps.length) {
            toast.success(t('workbench.planEventDone'));
            break;
          }
        }
        // 未完成当前步骤时不推进，下一章接着写同一步
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    } finally {
      setPlanProgress(null);
      await load();
    }
  };

  const stopPlan = () => {
    planAbortRef.current = true;
    generation.pause();
  };

  const saveToChapter = async () => {
    // 只保存正文任务的输出，避免把大纲误写进章节
    if (!chapterId || !chapterOutput.trim()) return;
    try {
      await api.patch(novelResourcePath(novelId, 'chapters', chapterId), {
        content: chapterOutput,
        markGenerated: true,
      });
      toast.success(t('common.saved'));
      setConfirmSave(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-muted">
        <Spinner /> {t('common.loading')}
      </div>
    );
  }

  const eventDone = activeEvent?.steps.length
    ? activeEvent.progress >= activeEvent.steps.length
    : false;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-soft">{t('workbench.title')}</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-muted">
            {activeEvent
              ? `${t('workbench.currentEvent')}：${activeEvent.title}　${t('workbench.eventProgress')} ${activeEvent.progress}/${activeEvent.steps.length}`
              : t('workbench.hint')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {activeProvider ? (
            <span className="chip chip-accent">
              <i className="fa-solid fa-plug text-[0.62rem]" aria-hidden />
              {activeProvider.name} · {activeProvider.defaultModel}
            </span>
          ) : (
            <Link href="/settings" className="chip text-warn">
              {t('workbench.noProvider')}
            </Link>
          )}
          <Link href={`/novels/${novelId}/events`} className="btn">
            <i className="fa-solid fa-list-check" aria-hidden />
            {t('nav.events')}
          </Link>
        </div>
      </header>

      <nav className="flex flex-wrap gap-1 border-b border-line pb-2">
        {STEPS.map((item, index) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setStep(item.key)}
            className={clsx(
              'flex items-center gap-2 rounded-[6px] px-3 py-1.5 text-[0.82rem] transition-colors duration-200',
              step === item.key
                ? 'bg-accent-soft font-semibold text-accent-strong'
                : 'text-ink-muted hover:bg-[var(--glass-bg-sunken)] hover:text-ink',
            )}
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-surface-sunken text-[0.68rem] font-semibold">
              {index + 1}
            </span>
            <i className={item.icon} aria-hidden />
            {t(item.labelKey)}
          </button>
        ))}
      </nav>

      {/* 上下文超出预算时，先在这里由用户决定是否保留全文发送 */}
      <BudgetConfirmPrompt generation={generation} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-4">
          {step === 'direction' ? (
            <Panel
              title={t('workbench.stepDirection')}
              description={t('workbench.directionHint')}
              actions={
                <Button
                  variant="primary"
                  onClick={generateDirections}
                  disabled={generation.status === 'running'}
                >
                  {generation.status === 'running' ? (
                    <Spinner />
                  ) : (
                    <i className="fa-solid fa-wand-magic-sparkles" aria-hidden />
                  )}
                  {directionOptions.length > 0
                    ? t('workbench.directionRegenerate')
                    : t('workbench.directionGenerate')}
                </Button>
              }
            >
              <div className="flex flex-col gap-3">
                {directionOptions.length > 0 ? (
                  <ul className="grid gap-3 md:grid-cols-2">
                    {directionOptions.map((option, index) => (
                      <li
                        key={`${option.title}-${index}`}
                        className={clsx(
                          'card animate-rise flex flex-col gap-2 p-3.5',
                          selectedDirection === option.title && 'border-accent-border',
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-semibold text-soft">{option.title}</span>
                          {option.tone ? <span className="chip">{option.tone}</span> : null}
                        </div>
                        <p className="text-xs leading-relaxed text-ink-muted">{option.summary}</p>
                        {option.risk ? (
                          <p className="text-[0.68rem] leading-relaxed text-warn">
                            {t('workbench.directionRisk')}：{option.risk}
                          </p>
                        ) : null}
                        <Button
                          size="sm"
                          variant={selectedDirection === option.title ? 'primary' : 'default'}
                          className="mt-auto self-start"
                          onClick={() => {
                            setSelectedDirection(option.title);
                            setCustomDirection(option.summary);
                          }}
                        >
                          {selectedDirection === option.title
                            ? t('workbench.directionUsed')
                            : t('workbench.directionUseThis')}
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-ink-faint">{t('workbench.streamIdle')}</p>
                )}

                <Field
                  label={t('workbench.directionCustom')}
                  hint={t('workbench.directionPlaceholder')}
                >
                  <TextArea
                    rows={3}
                    value={customDirection}
                    onChange={(event) => {
                      setCustomDirection(event.target.value);
                      setSelectedDirection('');
                    }}
                  />
                </Field>

                <Field label={t('setup.ruleExtra')}>
                  <TextArea
                    rows={2}
                    value={additionalInstruction}
                    onChange={(event) => setAdditionalInstruction(event.target.value)}
                  />
                </Field>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    onClick={confirmDirection}
                    disabled={!(selectedDirection || customDirection).trim()}
                  >
                    {t('workbench.directionConfirm')}
                    <i className="fa-solid fa-arrow-right" aria-hidden />
                  </Button>
                </div>
              </div>
            </Panel>
          ) : null}

          {step === 'outline' ? (
            <Panel
              title={t('workbench.stepOutline')}
              description={t('workbench.outlineHint')}
              actions={
                <>
                  <Button onClick={generateOutline} disabled={generation.status === 'running'}>
                    {generation.status === 'running' ? (
                      <Spinner />
                    ) : (
                      <i className="fa-solid fa-diagram-project" aria-hidden />
                    )}
                    {t('workbench.outlineGenerate')}
                  </Button>
                </>
              }
            >
              <div className="flex flex-col gap-3">
                {generation.status === 'running' && !activeEvent?.outline ? (
                  <div className="card max-h-72 overflow-y-auto p-3">
                    <pre className="text-xs leading-relaxed whitespace-pre-wrap">
                      {generation.text}
                    </pre>
                  </div>
                ) : activeEvent?.outline ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="chip chip-accent">{activeEvent.title}</span>
                      <span className="chip">
                        {t('workbench.eventProgress')} {activeEvent.progress}/
                        {activeEvent.steps.length}
                      </span>
                      {activeEvent.novelTime ? (
                        <span className="chip">
                          {t('chapters.timelineTime')}：{activeEvent.novelTime}
                        </span>
                      ) : null}
                    </div>
                    {/* 大纲正文可直接编辑，改完防抖落库 */}
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="panel-title">{t('workbench.outlineContent')}</p>
                      {outlineSaving ? (
                        <span className="text-[0.68rem] text-ink-faint">
                          {t('workbench.outlineSaving')}
                        </span>
                      ) : null}
                      {outlineHistory.length > 0 ? (
                        <Button size="sm" className="ml-auto" onClick={() => void undoOutline()}>
                          <i className="fa-solid fa-rotate-left" aria-hidden />
                          {t('workbench.undoOutline')}
                        </Button>
                      ) : null}
                    </div>
                    <TextArea
                      rows={16}
                      className="font-mono text-sm leading-relaxed"
                      value={outlineDraft}
                      onChange={(event) => onOutlineChange(event.target.value)}
                    />
                    {activeEvent.steps.length > 0 ? (
                      <ol className="flex flex-col gap-2">
                        {activeEvent.steps.map((item, index) => (
                          <li
                            key={`${item.title}-${index}`}
                            className={clsx(
                              'card flex items-start gap-3 p-3',
                              index < activeEvent.progress && 'opacity-60',
                              index === activeEvent.progress && 'border-accent-border',
                            )}
                          >
                            <span
                              className={clsx(
                                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[0.68rem] font-semibold',
                                index < activeEvent.progress
                                  ? 'bg-ok-soft text-ok'
                                  : index === activeEvent.progress
                                    ? 'bg-accent text-white'
                                    : 'bg-surface-sunken text-ink-faint',
                              )}
                            >
                              {index < activeEvent.progress ? (
                                <i className="fa-solid fa-check" aria-hidden />
                              ) : (
                                index + 1
                              )}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-soft">{item.title}</p>
                              {item.novelTime ? (
                                <p className="mt-0.5 text-[0.68rem] text-ink-faint">
                                  {t('chapters.timelineTime')}：{item.novelTime}
                                </p>
                              ) : null}
                              {item.detail ? (
                                <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                                  {item.detail}
                                </p>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ol>
                    ) : null}
                  </>
                ) : (
                  /*
                   * 还没有事件时的入口。
                   * 用户可以在这里从头写一份大纲，直接存成事件，不必先让 AI 生成。
                   */
                  <>
                    <p className="text-xs leading-relaxed text-ink-muted">
                      {t('workbench.outlineEmptyHint')}
                    </p>
                    <TextArea
                      rows={14}
                      className="font-mono text-sm leading-relaxed"
                      placeholder={t('workbench.outlinePlaceholder')}
                      value={outlineDraft}
                      onChange={(event) => onOutlineChange(event.target.value)}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="primary"
                        onClick={() => void saveDraftAsEvent()}
                        disabled={!outlineDraft.trim() || outlineSaving}
                      >
                        {outlineSaving ? (
                          <Spinner />
                        ) : (
                          <i className="fa-solid fa-floppy-disk" aria-hidden />
                        )}
                        {t('workbench.outlineSaveAsEvent')}
                      </Button>
                      <span className="text-xs text-ink-faint">
                        {t('workbench.outlineSaveAsEventHint')}
                      </span>
                    </div>
                  </>
                )}

                {/*
                  终端式的改写入口。
                  与上方正文分工明确：上方是「改成什么样」，这里是「按什么要求改」。
                */}
                <div className="overflow-hidden rounded-[10px] border border-black/25 bg-[#14161a] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                  <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
                    <span className="ml-2 font-mono text-[0.65rem] tracking-wide text-white/40">
                      {t('workbench.terminalTitle')}
                    </span>
                  </div>
                  <div className="flex items-start gap-2 px-3 py-2.5">
                    <span
                      className="shrink-0 font-mono text-sm leading-6 text-[#4ade80]"
                      aria-hidden
                    >
                      ›
                    </span>
                    <textarea
                      rows={2}
                      value={outlineReviseAsk}
                      placeholder={t('workbench.terminalPlaceholder')}
                      onChange={(event) => setOutlineReviseAsk(event.target.value)}
                      onKeyDown={(event) => {
                        // 回车发送，Shift 加回车换行
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          if (generation.status !== 'running' && activeEvent) void reviseOutline();
                        }
                      }}
                      className="min-h-[3rem] flex-1 resize-y bg-transparent font-mono text-sm leading-6 text-[#e8e8e8] outline-none placeholder:text-white/25"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 border-t border-white/10 px-3 py-1.5">
                    <span className="font-mono text-[0.62rem] text-white/30">
                      {t('workbench.terminalHint')}
                    </span>
                    <Button
                      size="sm"
                      variant="primary"
                      className="ml-auto"
                      onClick={() => void reviseOutline()}
                      disabled={
                        generation.status === 'running' || !activeEvent || !outlineReviseAsk.trim()
                      }
                    >
                      {generation.status === 'running' ? (
                        <Spinner />
                      ) : (
                        <i className="fa-solid fa-paper-plane" aria-hidden />
                      )}
                      {t('workbench.terminalSend')}
                    </Button>
                  </div>
                </div>

                {generation.error ? (
                  <p className="rounded-[6px] bg-danger-soft px-3 py-2 text-xs leading-relaxed text-danger">
                    {generation.error}
                  </p>
                ) : null}

                {/* 实时切分预览：改一句就能看到章数怎么变 */}
                <div className="rounded-[10px] border border-[var(--glass-border)] px-3.5 py-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <p className="panel-title">{t('workbench.splitPreview')}</p>
                    <span className="chip chip-accent">{draftSteps.length}</span>
                  </div>
                  {draftSteps.length === 0 ? (
                    <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">
                      {t('workbench.splitPreviewEmpty')}
                    </p>
                  ) : (
                    <ol className="mt-2 grid gap-1 sm:grid-cols-2">
                      {draftSteps.map((step, index) => (
                        <li
                          key={index}
                          className="flex items-baseline gap-2 text-xs leading-relaxed text-ink-muted"
                        >
                          <span className="shrink-0 font-mono text-[0.68rem] text-ink-faint">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{step.title}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* 大纲本身不会自动变成章节，这里给一个明确的动作入口 */}
                  <Button
                    onClick={() => void splitChapters()}
                    disabled={!activeEvent || draftSteps.length === 0}
                  >
                    <i className="fa-solid fa-list-ol" aria-hidden />
                    {t('workbench.splitChapters')}
                  </Button>
                  <Button
                    variant="primary"
                    className="ml-auto"
                    onClick={() => setStep('chapter')}
                    disabled={!activeEvent}
                  >
                    {t('workbench.outlineConfirm')}
                    <i className="fa-solid fa-arrow-right" aria-hidden />
                  </Button>
                </div>
              </div>
            </Panel>
          ) : null}

          {step === 'chapter' ? (
            <Panel
              title={t('workbench.stepChapter')}
              description={t('workbench.chapterHint')}
              actions={
                <>
                  <Button
                    variant="primary"
                    onClick={generateChapter}
                    disabled={generation.status === 'running' || !activeEvent}
                  >
                    {generation.status === 'running' ? (
                      <Spinner />
                    ) : (
                      <i className="fa-solid fa-pen-nib" aria-hidden />
                    )}
                    {t('workbench.chapterGenerate')}
                  </Button>
                  {generation.status === 'running' ? (
                    <Button variant="danger" onClick={generation.pause}>
                      <i className="fa-solid fa-pause" aria-hidden />
                      {t('workbench.chapterPause')}
                    </Button>
                  ) : null}
                  {generation.status === 'paused' ? (
                    <Button onClick={() => void generation.resume()}>
                      <i className="fa-solid fa-play" aria-hidden />
                      {t('workbench.chapterResume')}
                    </Button>
                  ) : null}
                </>
              }
            >
              <div className="flex flex-col gap-3">
                {!activeEvent ? (
                  <p className="rounded-[6px] bg-warn-soft px-3 py-2 text-xs leading-relaxed text-warn">
                    {t('workbench.noEventHint')}
                  </p>
                ) : null}

                {activeEvent && activeEvent.steps.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <Field label={t('workbench.currentStep')} hint={t('workbench.stepPickHint')}>
                      <Select
                        value={String(effectiveStepIndex)}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          // 选中的恰好是进度所在那一步时，回到「跟随进度」
                          setFocusStep(next === activeEvent.progress ? null : next);
                        }}
                      >
                        {activeEvent.steps.map((item, index) => (
                          <option key={`${item.title}-${index}`} value={index}>
                            {index + 1}. {item.title}
                            {index < activeEvent.progress
                              ? `（${t('workbench.stepDoneOption')}）`
                              : index === activeEvent.progress
                                ? `（${t('workbench.stepProgressOption')}）`
                                : ''}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {focusStep !== null && focusStep !== activeEvent.progress ? (
                      <p className="text-[0.68rem] leading-relaxed text-warn">
                        {t('workbench.stepOffProgress')}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t('nav.chapters')}>
                    <Select value={chapterId} onChange={(event) => setChapterId(event.target.value)}>
                      <option value="">{t('workbench.stepChapter')}</option>
                      {chapters.map((chapter) => (
                        <option key={chapter.id} value={chapter.id}>
                          第{chapter.volumeIndex}卷 第{chapter.indexNo}章 {chapter.title}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t('chapters.newChapter')}>
                    <TextInput
                      value={newChapterTitle}
                      placeholder={`第${chapters.length + 1}章`}
                      onChange={(event) => setNewChapterTitle(event.target.value)}
                    />
                  </Field>
                </div>

                <Field label={t('chapters.direction')} hint={t('chapters.directionHint')}>
                  <TextArea
                    rows={3}
                    value={selectedDirection || customDirection}
                    onChange={(event) => {
                      setCustomDirection(event.target.value);
                      setSelectedDirection('');
                    }}
                  />
                </Field>

                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs text-ink-muted">
                    {t('workbench.currentWords')} {formatNumber(currentWords)} /{' '}
                    {formatNumber(target)}
                  </span>
                  <ProgressBar
                    value={currentWords}
                    max={Math.max(1, Math.round(target * 1.3))}
                    className="max-w-xs flex-1"
                  />
                  <span className="text-xs text-ink-faint">{t('workbench.timeoutHint')}</span>
                  <Button
                    size="sm"
                    className="ml-auto"
                    onClick={() => void update({ showSpeakerName: !settings.showSpeakerName })}
                    aria-pressed={settings.showSpeakerName}
                  >
                    <i
                      className={
                        settings.showSpeakerName ? 'fa-solid fa-user-tag' : 'fa-solid fa-user-slash'
                      }
                      aria-hidden
                    />
                    {settings.showSpeakerName
                      ? t('chapters.hideSpeakerName')
                      : t('chapters.showSpeakerName')}
                  </Button>
                </div>

                {/*
                  计划性生成：一次指定要写到第几章，逐章串行推进。
                  每章结束后立即落库，再取回最新进度决定下一章写哪一步。
                */}
                <div className="flex flex-wrap items-end gap-3 rounded-[6px] border border-line-soft bg-surface-sunken px-3 py-2.5">
                  <Field label={t('workbench.planCount')} hint={t('workbench.planHint')}>
                    <TextInput
                      type="number"
                      min={1}
                      max={50}
                      value={String(planCount)}
                      onChange={(event) =>
                        setPlanCount(Math.max(1, Math.min(50, Number(event.target.value) || 1)))
                      }
                      className="w-24"
                    />
                  </Field>
                  {planProgress ? (
                    <>
                      <span className="chip chip-accent">
                        {t('workbench.planProgress')} {planProgress.done}/{planProgress.total}
                      </span>
                      <Button variant="danger" onClick={stopPlan}>
                        <i className="fa-solid fa-stop" aria-hidden />
                        {t('workbench.planStop')}
                      </Button>
                    </>
                  ) : (
                    <Button
                      onClick={() => void generatePlan()}
                      disabled={generation.status === 'running' || !activeEvent}
                    >
                      <i className="fa-solid fa-forward-fast" aria-hidden />
                      {t('workbench.planStart')}
                    </Button>
                  )}
                </div>

                {generation.message ? (
                  <p className="text-xs text-accent-strong">{generation.message}</p>
                ) : null}

                {/*
                  推理模型的思考过程。
                  与正文分开呈现：正文只放成品内容，思考过程收在可折叠区里，
                  让用户能看清模型确实在工作，而不是对着空白等待。
                */}
                {generation.reasoning ? (
                  <details className="rounded-[6px] border border-line-soft bg-surface-sunken px-3 py-2">
                    <summary className="cursor-pointer text-[0.7rem] font-semibold text-ink-muted">
                      {t('workbench.reasoningTitle')}
                    </summary>
                    <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-[0.68rem] leading-relaxed text-ink-faint">
                      {generation.reasoning}
                    </pre>
                  </details>
                ) : null}

                {generation.truncated ? (
                  <p className="rounded-[6px] border border-warn-border bg-warn-soft px-3 py-2 text-xs leading-relaxed text-warn">
                    {generation.truncated}
                  </p>
                ) : null}

                <div className="card max-h-[40rem] min-h-[16rem] overflow-y-auto px-5 py-4">
                  {chapterOutput ? (
                    <MarkdownView
                      content={chapterOutput}
                      speakers={speakerColors}
                      showSpeakerName={settings.showSpeakerName}
                    />
                  ) : (
                    <p className="text-xs text-ink-faint">{t('workbench.chapterEmpty')}</p>
                  )}
                </div>

                {generation.queries.length > 0 ? (
                  <div className="rounded-[6px] border border-line-soft bg-surface-sunken px-3 py-2.5">
                    <p className="text-[0.7rem] font-semibold text-ink-muted">
                      {t('workbench.queriesTitle')}
                    </p>
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {generation.queries.map((query) => (
                        <li
                          key={query.id}
                          className={clsx('chip', query.filled ? 'text-ok' : 'text-warn')}
                        >
                          <i
                            className={query.filled ? 'fa-solid fa-check' : 'fa-solid fa-circle-question'}
                            aria-hidden
                          />
                          {query.keyword}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {generation.recalls.length > 0 ? (
                  <div className="rounded-[6px] border border-warn-border bg-warn-soft px-3 py-2.5">
                    <p className="text-[0.7rem] font-semibold text-warn">
                      {t('workbench.recallsTitle')}
                    </p>
                    <ul className="mt-1.5 flex flex-col gap-1.5">
                      {generation.recalls.map((item) => (
                        <li key={item.id} className="text-xs leading-relaxed text-ink-muted">
                          {item.eventTitle}：{item.reason}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1.5 text-[0.68rem] text-ink-faint">
                      {t('workbench.recallsHint')}
                    </p>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    onClick={() => setConfirmSave(true)}
                    disabled={!chapterOutput.trim() || !chapterId}
                  >
                    <i className="fa-solid fa-floppy-disk" aria-hidden />
                    {t('workbench.chapterSave')}
                  </Button>
                  <Button onClick={() => setDiscardedText(generation.text)}>
                    {t('workbench.chapterDiscard')}
                  </Button>
                  {chapterId ? (
                    <Link href={`/novels/${novelId}/chapters/${chapterId}`} className="btn">
                      <i className="fa-solid fa-book-open" aria-hidden />
                      {t('chapters.read')}
                    </Link>
                  ) : null}
                </div>
              </div>
            </Panel>
          ) : null}

          {step === 'progress' ? (
            <Panel title={t('workbench.stepProgress')} description={t('workbench.progressHint')}>
              <div className="flex flex-col gap-3">
                {generation.advance ? (
                  <div className="flex flex-wrap gap-2">
                    <span className="chip chip-accent">
                      {t('workbench.eventProgress')} {generation.advance.progress}/
                      {generation.advance.stepCount}
                    </span>
                    {generation.advance.completed ? (
                      <span className="chip text-ok">{t('workbench.eventCompleted')}</span>
                    ) : generation.advance.partial ? (
                      <span className="chip text-warn">{t('workbench.stepPartial')}</span>
                    ) : (
                      <span className="chip">{t('workbench.stepDone')}</span>
                    )}
                  </div>
                ) : null}

                {generation.advance?.partial ? (
                  <p className="rounded-[6px] bg-warn-soft px-3 py-2 text-xs leading-relaxed text-warn">
                    {generation.advance.partial}
                  </p>
                ) : null}

                {generation.extracted ? (
                  <div className="flex flex-col gap-1.5">
                    <p className="panel-title">{t('workbench.extractTitle')}</p>
                    <p className="text-xs leading-relaxed text-ink-muted">
                      {t('workbench.extractResult')
                        .replace('{entries}', String(generation.extracted.entries))
                        .replace('{characters}', String(generation.extracted.characters))}
                    </p>
                    {generation.extracted.names.length > 0 ? (
                      <ul className="flex flex-wrap gap-1.5">
                        {generation.extracted.names.map((name) => (
                          <li key={name} className="chip">
                            {name}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}

                {eventDone || generation.advance?.completed ? (
                  <div className="rounded-[6px] border border-accent-border bg-accent-soft px-3.5 py-3">
                    <p className="text-sm font-semibold text-accent-strong">
                      {t('workbench.eventDoneTitle')}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                      {t('workbench.eventDoneHint')}
                    </p>
                    <Button
                      variant="primary"
                      size="sm"
                      className="mt-2.5"
                      onClick={() => setStep('direction')}
                    >
                      <i className="fa-solid fa-compass" aria-hidden />
                      {t('workbench.directionNext')}
                    </Button>
                  </div>
                ) : activeEvent ? (
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/novels/${novelId}/events`} className="btn">
                      <i className="fa-solid fa-list-check" aria-hidden />
                      {t('nav.events')}
                    </Link>
                    <Link href={`/novels/${novelId}/timeline`} className="btn">
                      <i className="fa-solid fa-timeline" aria-hidden />
                      {t('nav.timeline')}
                    </Link>
                  </div>
                ) : (
                  <p className="text-xs text-ink-faint">{t('workbench.progressIdle')}</p>
                )}
              </div>
            </Panel>
          ) : null}
        </div>

        <aside className="flex flex-col gap-4">
          <Panel title={t('workbench.contextTitle')} description={t('workbench.contextHint')}>
            <ContextInspector
              meta={generation.meta}
              catalog={layerCatalog}
              selected={preferences?.contextLayers ?? []}
              onChange={(keys) => void saveContextLayers(keys)}
            />
          </Panel>

          <Panel title={t('common.preview')}>
            <ul className="flex flex-col gap-2 text-xs">
              <li className="flex items-center justify-between">
                <span className="text-ink-muted">{t('workbench.step')}</span>
                <span
                  className={clsx(
                    'chip',
                    generation.status === 'running' && 'chip-accent animate-pulse-soft',
                    generation.status === 'error' && 'text-danger',
                    generation.status === 'done' && 'text-ok',
                  )}
                >
                  {t(
                    `workbench.stream${
                      generation.status === 'running'
                        ? 'Running'
                        : generation.status === 'paused'
                          ? 'Paused'
                          : generation.status === 'error'
                            ? 'Error'
                            : generation.status === 'done'
                              ? 'Done'
                              : 'Idle'
                    }`,
                  )}
                </span>
              </li>
              {generation.usage ? (
                <>
                  <li className="flex items-center justify-between">
                    <span className="text-ink-muted">输入 token</span>
                    <span className="font-mono">{formatNumber(generation.usage.promptTokens)}</span>
                  </li>
                  <li className="flex items-center justify-between">
                    <span className="text-ink-muted">输出 token</span>
                    <span className="font-mono">
                      {formatNumber(generation.usage.completionTokens)}
                    </span>
                  </li>
                  <li className="flex items-center justify-between">
                    <span className="text-ink-muted">{t('common.total')}</span>
                    <span className="font-mono">
                      {formatNumber(generation.usage.totalTokens)}
                      {generation.usage.estimated ? ' 估算' : ''}
                    </span>
                  </li>
                  <li className="flex items-center justify-between">
                    <span className="text-ink-muted">耗时</span>
                    <span className="font-mono">
                      {(generation.usage.durationMs / 1000).toFixed(1)}s
                    </span>
                  </li>
                </>
              ) : null}
              {generation.error ? (
                <li className="rounded-[6px] bg-danger-soft px-2.5 py-2 leading-relaxed text-danger">
                  {generation.error}
                </li>
              ) : null}
            </ul>
            <Button
              size="sm"
              className="mt-3"
              onClick={generation.reset}
              disabled={generation.status === 'idle'}
            >
              <i className="fa-solid fa-broom" aria-hidden />
              {t('common.reset')}
            </Button>
          </Panel>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmSave}
        title={t('workbench.chapterSave')}
        message={t('workbench.saveConfirm')}
        onCancel={() => setConfirmSave(false)}
        onConfirm={saveToChapter}
      />
    </div>
  );
}
