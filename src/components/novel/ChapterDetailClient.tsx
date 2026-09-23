'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, formatDateTime, formatNumber, novelResourcePath } from '@/lib/client/api';
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
import { MarkdownEditor } from '@/components/markdown/MarkdownEditor';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { ImmersiveReader } from './ImmersiveReader';
import { BudgetConfirmPrompt } from './BudgetConfirmPrompt';
import { useGeneration } from '@/hooks/useGeneration';
import { buildSpeakerColors } from '@/lib/markdown/speakers';
import { countWords } from '@/lib/token';
import type {
  Bookmark,
  ChapterWithVolume,
  Character,
  NovelPreferences,
  StoryEvent,
} from '@/lib/types';

/** 章节阅读与编辑页。同时承担生成控制台的角色。 */

type RevisionMode = 'rewrite' | 'continue' | 'expand' | 'condense' | 'polish';

const REVISION_LABELS: Record<RevisionMode, string> = {
  rewrite: '局部重写',
  continue: '续写',
  expand: '扩写',
  condense: '缩写',
  polish: '润色',
};

export function ChapterDetailClient({
  novelId,
  chapterId,
}: {
  novelId: string;
  chapterId: string;
}) {
  const { t, settings, update } = useSettings();
  const toast = useToast();
  const generation = useGeneration();

  const [chapter, setChapter] = useState<ChapterWithVolume | null>(null);
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [siblings, setSiblings] = useState<ChapterWithVolume[]>([]);
  const [event, setEvent] = useState<StoryEvent | null>(null);
  const [preferences, setPreferences] = useState<NovelPreferences | null>(null);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  /** 角色图鉴，用于把正文里的对白按角色配色染色 */
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selection, setSelection] = useState('');
  const [instruction, setInstruction] = useState('');
  const [revisionMode, setRevisionMode] = useState<RevisionMode>('rewrite');
  const [timelineSort, setTimelineSort] = useState('');
  const [stepIndex, setStepIndex] = useState(0);
  const [pendingBookmarkDelete, setPendingBookmarkDelete] = useState<Bookmark | null>(null);
  /** 是否处于沉浸阅读模式 */
  const [immersive, setImmersive] = useState(false);

  /** 角色发言配色表，取自角色图鉴，正文里的对白按它染色 */
  const speakerColors = useMemo(() => buildSpeakerColors(characters), [characters]);

  /*
   * 沉浸模式与地址栏的 #immersive 保持同步。
   *
   * 这样直接带锚点打开链接就能进入沉浸阅读，刷新也不会掉出来；
   * 用 replaceState 而不是 pushState，避免每进出一次就多一条历史记录。
   */
  const setImmersiveMode = useCallback((next: boolean) => {
    setImmersive(next);
    const { pathname, search } = window.location;
    window.history.replaceState(
      null,
      '',
      next ? `${pathname}${search}#immersive` : `${pathname}${search}`,
    );
  }, []);

  useEffect(() => {
    setImmersive(window.location.hash === '#immersive');
  }, []);


  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [chapterResult, chapterList, preferenceResult, bookmarkResult, characterResult] =
        await Promise.all([
          api.get<{ chapter: ChapterWithVolume; content: string }>(
            novelResourcePath(novelId, 'chapters', chapterId),
          ),
          api.get<ChapterWithVolume[]>(novelResourcePath(novelId, 'chapters')),
          api.get<{ preferences: NovelPreferences }>(novelResourcePath(novelId, 'preferences')),
          api.get<Bookmark[]>(novelResourcePath(novelId, 'bookmarks')),
          api.get<Character[]>(novelResourcePath(novelId, 'characters')),
        ]);
      setChapter(chapterResult.chapter);
      setContent(chapterResult.content);
      setOriginalContent(chapterResult.content);
      setSiblings(chapterList);
      setPreferences(preferenceResult.preferences);
      setBookmarks(bookmarkResult);
      setCharacters(characterResult);
      setTimelineSort(chapterResult.chapter.timelineSort);
      setStepIndex(chapterResult.chapter.stepIndex ?? 0);
      const eventId = chapterResult.chapter.eventId;
      if (eventId) {
        const result = await api.get<{ event: StoryEvent }>(
          novelResourcePath(novelId, 'story-events', eventId),
        );
        setEvent(result.event);
      } else {
        setEvent(null);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    } finally {
      setLoading(false);
    }
  }, [chapterId, novelId, t, toast]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novelId, chapterId]);

  /** 把生成结果应用到编辑区。由用户显式触发，避免生成过程静默覆盖正在编辑的内容。 */
  const applyGeneratedText = () => {
    setContent(generation.text);
    toast.success(t('chapters.revisedHint'));
  };

  const currentWords = useMemo(() => countWords(content), [content]);
  const target = preferences?.targetWords ?? 3000;
  const tolerance = preferences?.wordTolerancePercent ?? 15;
  const delta = currentWords - target;
  const withinTolerance = Math.abs(delta) <= (target * tolerance) / 100;
  const dirty = content !== originalContent;
  const hasGeneratedResult = generation.status !== 'idle' && generation.text.trim().length > 0;

  const index = siblings.findIndex((item) => item.id === chapterId);
  const previous = index > 0 ? siblings[index - 1] : undefined;
  const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : undefined;

  const chapterBookmarks = bookmarks.filter((bookmark) => bookmark.chapterId === chapterId);

  const saveContent = async () => {
    setSaving(true);
    try {
      const result = await api.patch<{ chapter: ChapterWithVolume; wordCount: number }>(
        novelResourcePath(novelId, 'chapters', chapterId),
        { content, markGenerated: false },
      );
      setOriginalContent(content);
      if (result.chapter) setChapter({ ...result.chapter, wordCount: result.wordCount });
      toast.success(t('common.saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    } finally {
      setSaving(false);
    }
  };

  const saveMeta = async () => {
    try {
      const result = await api.patch<ChapterWithVolume>(
        novelResourcePath(novelId, 'chapters', chapterId),
        { timelineSort, stepIndex },
      );
      if (result) setChapter(result);
      toast.success(t('common.saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  const runGeneration = async (mode: RevisionMode | 'regenerate') => {
    if ((mode === 'rewrite' || mode === 'polish') && !instruction.trim() && !selection.trim()) {
      toast.error(t('chapters.selectionHint'));
      return;
    }
    const taskType = mode === 'regenerate' ? 'chapter' : 'chapter_revise';
    // 这里不直接写入章节，结果先交给用户确认，再由「应用」按钮落盘
    const payload = {
      novelId,
      chapterId,
      taskType,
      instruction: [selection ? `需要改写的原文片段：\n${selection}` : '', instruction]
        .filter(Boolean)
        .join('\n\n'),
      direction: chapter?.direction ?? '',
      revisionMode: REVISION_LABELS[mode as RevisionMode] ?? '按指令修改',
      existingContent: mode === 'regenerate' ? '' : content,
      saveToChapter: false,
      eventId: chapter?.eventId ?? undefined,
      stepIndex: chapter?.stepIndex ?? undefined,
    };
    await generation.start(payload);
  };

  const removeBookmark = async () => {
    if (!pendingBookmarkDelete) return;
    try {
      await api.delete(novelResourcePath(novelId, 'bookmarks', pendingBookmarkDelete.id));
      setPendingBookmarkDelete(null);
      setBookmarks(await api.get<Bookmark[]>(novelResourcePath(novelId, 'bookmarks')));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  const addBookmark = async () => {
    try {
      await api.post(novelResourcePath(novelId, 'bookmarks'), {
        chapterId,
        label: selection.slice(0, 24) || chapter?.title || '',
        anchor: selection.slice(0, 200),
        note: instruction.slice(0, 200),
      });
      setBookmarks(await api.get<Bookmark[]>(novelResourcePath(novelId, 'bookmarks')));
      toast.success(t('common.saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  if (loading || !chapter) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-muted">
        <Spinner /> {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-ink-faint">
            第{chapter.volumeIndex}卷 · 第{chapter.indexNo}章
          </p>
          <h1 className="mt-0.5 text-lg font-semibold text-soft">{chapter.title}</h1>
          <p className="mt-1 text-xs text-ink-muted">
            {formatNumber(currentWords)} / {formatNumber(target)} {t('common.words')}
            {dirty ? ` · ${t('chapters.revisedHint')}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {previous ? (
            <Link href={`/novels/${novelId}/chapters/${previous.id}`} className="btn">
              <i className="fa-solid fa-chevron-left" aria-hidden />
            </Link>
          ) : null}
          {next ? (
            <Link href={`/novels/${novelId}/chapters/${next.id}`} className="btn">
              <i className="fa-solid fa-chevron-right" aria-hidden />
            </Link>
          ) : null}
          <Link href={`/novels/${novelId}/workbench?chapterId=${chapterId}`} className="btn">
            <i className="fa-solid fa-wand-magic-sparkles" aria-hidden />
            {t('nav.workbench')}
          </Link>
          <Button variant="primary" onClick={saveContent} disabled={saving || !dirty}>
            {saving ? <Spinner /> : <i className="fa-solid fa-floppy-disk" aria-hidden />}
            {t('chapters.saveContent')}
          </Button>
        </div>
      </header>

      {/* 上下文超出预算时，先在这里由用户决定是否保留全文发送 */}
      <BudgetConfirmPrompt generation={generation} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-4">
          <Panel title={t('chapters.editContent')}>
            <MarkdownEditor
              value={content}
              rows={22}
              onSelectionChange={setSelection}
              onChange={setContent}
              placeholder={t('chapters.contentPlaceholder')}
              speakers={speakerColors}
              actions={
                <>
                  <span className="text-xs text-ink-faint">
                    {formatNumber(currentWords)} {t('common.words')}
                  </span>
                  <span className={clsx('chip', withinTolerance ? 'text-ok' : 'text-warn')}>
                    {withinTolerance
                      ? t('chapters.withinTolerance')
                      : `${delta > 0 ? '+' : ''}${formatNumber(delta)}`}
                  </span>
                </>
              }
            />
          </Panel>

          <Panel title={t('chapters.regenerate')}>
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={revisionMode}
                  onChange={(event) => setRevisionMode(event.target.value as RevisionMode)}
                  className="w-auto"
                >
                  {(Object.keys(REVISION_LABELS) as RevisionMode[]).map((mode) => (
                    <option key={mode} value={mode}>
                      {REVISION_LABELS[mode]}
                    </option>
                  ))}
                </Select>
                <Button onClick={() => void runGeneration(revisionMode)} disabled={generation.status === 'running'}>
                  <i className="fa-solid fa-pen-fancy" aria-hidden />
                  {t('common.generate')}
                </Button>
                <Button
                  onClick={() => void runGeneration('regenerate')}
                  disabled={generation.status === 'running'}
                >
                  <i className="fa-solid fa-rotate" aria-hidden />
                  {t('chapters.regenerate')}
                </Button>
                {generation.status === 'running' ? (
                  <Button variant="danger" onClick={generation.pause}>
                    <i className="fa-solid fa-pause" aria-hidden />
                    {t('chapters.pause')}
                  </Button>
                ) : null}
                {generation.status === 'paused' ? (
                  <Button variant="primary" onClick={() => void generation.resume()}>
                    <i className="fa-solid fa-play" aria-hidden />
                    {t('chapters.resume')}
                  </Button>
                ) : null}
              </div>

              <Field label={t('chapters.selectedText')} hint={t('chapters.selectionHint')}>
                <TextArea
                  rows={3}
                  value={selection}
                  onChange={(event) => setSelection(event.target.value)}
                  placeholder="在预览区选中文本后会自动填入"
                />
              </Field>
              <Field label={t('chapters.direction')}>
                <TextArea
                  rows={2}
                  value={instruction}
                  onChange={(event) => setInstruction(event.target.value)}
                  placeholder={t('workbench.outlineRevisePlaceholder')}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setSelection('')}>
                  {t('chapters.clearSelection')}
                </Button>
                <Button size="sm" onClick={addBookmark}>
                  <i className="fa-solid fa-bookmark" aria-hidden />
                  {t('chapters.addBookmark')}
                </Button>
              </div>

              {generation.status !== 'idle' ? (
                <div className="card max-h-96 overflow-y-auto p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
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
                                : 'Done'
                        }`,
                      )}
                    </span>
                    {generation.message ? (
                      <span className="text-ink-faint">{generation.message}</span>
                    ) : null}
                    {generation.usage ? (
                      <span className="text-ink-faint">
                        {formatNumber(generation.usage.totalTokens)} token
                      </span>
                    ) : null}
                    {hasGeneratedResult ? (
                      <Button size="sm" variant="primary" className="ml-auto" onClick={applyGeneratedText}>
                        <i className="fa-solid fa-arrow-down-to-line" aria-hidden />
                        {t('common.apply')}
                      </Button>
                    ) : null}
                  </div>
                  {generation.error ? (
                    <p className="text-xs leading-relaxed text-danger">{generation.error}</p>
                  ) : (
                    <p className="text-xs leading-relaxed whitespace-pre-wrap text-ink-muted">
                      {generation.text.slice(-1600)}
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          </Panel>

          <Panel
            title={t('chapters.previewTitle')}
            actions={
              <>
                <Button
                  size="sm"
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
                <Button size="sm" variant="primary" onClick={() => setImmersiveMode(true)}>
                  <i className="fa-solid fa-book-open-reader" aria-hidden />
                  {t('chapters.immersive')}
                </Button>
              </>
            }
          >
            <MarkdownView
              content={content}
              onSelectText={setSelection}
              speakers={speakerColors}
              showSpeakerName={settings.showSpeakerName}
            />
          </Panel>
        </div>

        <aside className="flex flex-col gap-4">
          <Panel title={t('chapters.event')} description={t('chapters.eventHint')}>
            {event ? (
              <div className="grid gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip chip-accent">{event.title}</span>
                  <span className="chip">{t(`events.status.${event.status}`)}</span>
                  {event.novelTime ? <span className="chip">{event.novelTime}</span> : null}
                </div>
                <div className="grid gap-1.5">
                  {event.steps.map((step, position) => (
                    <div
                      key={`${step.title}-${position}`}
                      className={clsx(
                        'flex items-start gap-2 rounded-md border border-line px-2.5 py-1.5 text-xs',
                        position < event.progress && 'text-ok',
                        position === event.progress && 'border-accent-soft bg-accent-soft text-soft',
                        position > event.progress && 'text-ink-faint',
                      )}
                    >
                      <span className="font-mono text-[0.65rem] text-ink-faint">
                        {String(position + 1).padStart(2, '0')}
                      </span>
                      <span className="min-w-0 flex-1 leading-relaxed">{step.title}</span>
                      {step.novelTime ? (
                        <span className="shrink-0 text-[0.65rem] text-ink-faint">{step.novelTime}</span>
                      ) : null}
                    </div>
                  ))}
                </div>
                <p className="text-[0.68rem] leading-relaxed text-ink-faint">
                  {t('chapters.eventProgress', { done: event.progress, total: event.steps.length })}
                </p>
              </div>
            ) : (
              <p className="text-xs text-ink-faint">{t('chapters.eventNone')}</p>
            )}
          </Panel>

          <Panel title={t('chapters.chapterMeta')}>
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('chapters.timelineTime')} hint={t('chapters.timelineTimeHint')}>
                  <TextInput
                    value={timelineSort}
                    onChange={(event) => setTimelineSort(event.target.value)}
                  />
                </Field>
                <Field label={t('chapters.stepIndex')}>
                  <TextInput
                    type="number"
                    min={0}
                    value={stepIndex}
                    onChange={(event) => setStepIndex(Number(event.target.value))}
                  />
                </Field>
              </div>
              <Button variant="primary" onClick={saveMeta}>
                <i className="fa-solid fa-floppy-disk" aria-hidden />
                {t('common.save')}
              </Button>
            </div>
          </Panel>

          <Panel title={t('chapters.bookmarks')} description={t('search.bookmarkNote')}>
            {chapterBookmarks.length === 0 ? (
              <p className="text-xs text-ink-faint">{t('search.noBookmarks')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {chapterBookmarks.map((bookmark) => (
                  <li key={bookmark.id} className="card flex items-start gap-2 p-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-soft">
                        {bookmark.label || t('chapters.addBookmark')}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-[0.68rem] leading-relaxed text-ink-faint">
                        {bookmark.anchor || bookmark.note}
                      </p>
                      <p className="mt-1 text-[0.62rem] text-ink-faint">
                        {formatDateTime(bookmark.createdAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost px-1.5 py-1 text-danger"
                      onClick={() => setPendingBookmarkDelete(bookmark)}
                      aria-label={t('common.delete')}
                    >
                      <i className="fa-solid fa-trash-can text-[0.7rem]" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={t('overview.progress')}>
            <ProgressBar value={currentWords} max={Math.max(1, Math.round(target * 1.4))} />
            <p className="mt-2 text-xs text-ink-muted">
              {t('chapters.target')} {formatNumber(target)} {t('common.words')}，{t('setup.wordTolerance')}{' '}
              {tolerance}%
            </p>
            <p className="mt-1 text-xs text-ink-faint">
              {t('settings.readerFontSize')} {settings.readerFontSize}px
            </p>
          </Panel>
        </aside>
      </div>

      <ConfirmDialog
        open={pendingBookmarkDelete !== null}
        title={t('common.delete')}
        message={t('search.deleteBookmarkConfirm')}
        danger
        onCancel={() => setPendingBookmarkDelete(null)}
        onConfirm={removeBookmark}
      />

      {immersive ? (
        <ImmersiveReader
          title={chapter?.title ?? ''}
          content={content}
          speakers={speakerColors}
          onClose={() => setImmersiveMode(false)}
        />
      ) : null}
    </div>
  );
}
