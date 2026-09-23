'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { normalizeOptionList } from '@/lib/ai/prompts';
import { buildSpeakerColors } from '@/lib/markdown/speakers';
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
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<StepKey>('direction');

  const [customDirection, setCustomDirection] = useState('');
  const [selectedDirection, setSelectedDirection] = useState('');
  const [additionalInstruction, setAdditionalInstruction] = useState('');
  const [chapterId, setChapterId] = useState('');
  const [newChapterTitle, setNewChapterTitle] = useState('');
  const [outlineReviseAsk, setOutlineReviseAsk] = useState('');
  const [confirmSave, setConfirmSave] = useState(false);
  /** 被用户主动丢弃的那一段生成结果。新的生成产生不同文本时会自动恢复显示。 */
  const [discardedText, setDiscardedText] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [chapterList, preferenceResult, providerResult, eventResult, characterResult] =
        await Promise.all([
          api.get<ChapterWithVolume[]>(novelResourcePath(novelId, 'chapters')),
          api.get<{ preferences: NovelPreferences }>(novelResourcePath(novelId, 'preferences')),
          api.get<{ providers: Provider[] }>('/api/providers'),
          api.get<StoryEventListPayload>(novelResourcePath(novelId, 'story-events')),
          api.get<Character[]>(novelResourcePath(novelId, 'characters')),
        ]);
      setChapters(chapterList);
      setPreferences(preferenceResult.preferences);
      setProviders(providerResult.providers);
      setCurrentEvent(eventResult.current);
      setCharacters(characterResult);

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
    setStep('outline');
    await generation.start({
      novelId,
      taskType: 'outline_revise',
      instruction: outlineReviseAsk,
      eventId: activeEvent.id,
      existingContent: activeEvent.outline,
    });
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
      const nextStepIndex = activeEvent ? activeEvent.progress : undefined;
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
      autoAdvanceEvent: preferences?.autoAdvanceEvent ?? true,
      autoExtractSettings: preferences?.autoExtractSettings ?? true,
    });
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
                    <div className="card max-h-[32rem] overflow-y-auto px-5 py-4">
                      <MarkdownView content={activeEvent.outline} />
                    </div>
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
                  <p className="text-xs text-ink-faint">{t('outline.emptyHint')}</p>
                )}

                <Field
                  label={t('workbench.outlineRevise')}
                  hint={t('workbench.outlineRevisePlaceholder')}
                >
                  <TextArea
                    rows={3}
                    value={outlineReviseAsk}
                    onChange={(event) => setOutlineReviseAsk(event.target.value)}
                  />
                </Field>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    onClick={reviseOutline}
                    disabled={generation.status === 'running' || !activeEvent}
                  >
                    <i className="fa-solid fa-pen-fancy" aria-hidden />
                    {t('workbench.outlineRevise')}
                  </Button>
                  {/* 大纲本身不会自动变成章节，这里给一个明确的动作入口 */}
                  <Button
                    onClick={() => void splitChapters()}
                    disabled={!activeEvent || activeEvent.steps.length === 0}
                  >
                    <i className="fa-solid fa-list-ol" aria-hidden />
                    {t('workbench.splitChapters')}
                  </Button>
                  <Button
                    variant="primary"
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
                  <div className="rounded-[6px] border border-line-soft bg-surface-sunken px-3 py-2.5">
                    <p className="text-[0.7rem] font-semibold text-ink-muted">
                      {t('workbench.currentStep')}
                    </p>
                    <p className="mt-1 text-sm text-soft">
                      {activeEvent.steps[activeEvent.progress]?.title ?? t('workbench.eventDone')}
                    </p>
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

                {generation.message ? (
                  <p className="text-xs text-accent-strong">{generation.message}</p>
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
            <ContextInspector meta={generation.meta} />
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
