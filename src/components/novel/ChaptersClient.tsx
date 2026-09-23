'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, novelResourcePath } from '@/lib/client/api';
import { useSettings } from '@/components/providers/SettingsProvider';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import {
  Button,
  EmptyState,
  Field,
  Panel,
  ProgressBar,
  Select,
  Spinner,
  TextArea,
  TextInput,
} from '@/components/ui/primitives';
import { formatNumber } from '@/lib/client/api';
import type {
  ChapterStatus,
  ChapterWithVolume,
  NovelPreferences,
  StoryEvent,
  StoryEventListPayload,
  Tag,
  Volume,
} from '@/lib/types';

/** 章节目录。按卷分组展示，可新建卷与章节、编辑元数据、跳转到阅读页。 */

export function ChaptersClient({ novelId }: { novelId: string }) {
  const { t } = useSettings();
  const toast = useToast();

  const [chapters, setChapters] = useState<ChapterWithVolume[]>([]);
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [events, setEvents] = useState<StoryEvent[]>([]);
  const [preferences, setPreferences] = useState<NovelPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | ChapterStatus>('all');
  const [tagFilter, setTagFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ChapterWithVolume | null>(null);
  /** 待设为废案的章节。目录里的删除一律先走废案，不直接抹除。 */
  const [pendingScrap, setPendingScrap] = useState<ChapterWithVolume | null>(null);
  const [pendingVolumeDelete, setPendingVolumeDelete] = useState<Volume | null>(null);
  const [newVolumeOpen, setNewVolumeOpen] = useState(false);
  /** 废案章节。不参与目录的卷章分组，单独成区展示。 */
  const [scrapped, setScrapped] = useState<ChapterWithVolume[]>([]);
  /** 废案区是否展开 */
  const [scrapOpen, setScrapOpen] = useState(false);
  /** 待彻底删除的废案 */
  const [pendingPurge, setPendingPurge] = useState<ChapterWithVolume | null>(null);

  const [form, setForm] = useState({
    title: '',
    /** 章节序号用整数输入，避免让用户手写「第一章」这类汉字标题 */
    index: '',
    volumeId: '',
    direction: '',
    eventId: '',
    stepIndex: 0,
    timelineSort: '',
    status: 'planned' as ChapterStatus,
    tags: [] as string[],
    tagDraft: '',
  });
  const [volumeForm, setVolumeForm] = useState({ title: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [
        chapterResult,
        scrapResult,
        volumeResult,
        tagResult,
        preferenceResult,
        eventResult,
      ] = await Promise.all([
        api.get<ChapterWithVolume[]>(novelResourcePath(novelId, 'chapters')),
        // 废案单独取，它们不参与目录分组
        api.get<ChapterWithVolume[]>(`${novelResourcePath(novelId, 'chapters')}?scope=scrapped`),
        api.get<Volume[]>(novelResourcePath(novelId, 'volumes')),
        api.get<Tag[]>(novelResourcePath(novelId, 'tags')),
        api.get<{ preferences: NovelPreferences }>(novelResourcePath(novelId, 'preferences')),
        api.get<StoryEventListPayload>(novelResourcePath(novelId, 'story-events')),
      ]);
      setChapters(chapterResult);
      setScrapped(scrapResult);
      setVolumes(volumeResult);
      setTags(tagResult);
      setPreferences(preferenceResult.preferences);
      // 集合地址返回事件、当前事件与已完成事件三部分，这里只需要事件清单
      setEvents(eventResult.events ?? []);
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

  const grouped = useMemo(() => {
    const filtered = chapters.filter((chapter) => {
      if (statusFilter !== 'all' && chapter.status !== statusFilter) return false;
      if (tagFilter && !(chapter.tags ?? []).some((tag) => tag.id === tagFilter)) return false;
      return true;
    });
    return volumes.map((volume) => ({
      volume,
      chapters: filtered.filter((chapter) => chapter.volumeId === volume.id),
    }));
  }, [chapters, volumes, statusFilter, tagFilter]);

  const openCreate = () => {
    setForm({
      // 标题留空由提交时按序号补，序号预填为下一个可用位置
      title: '',
      index: String(chapters.length + 1),
      volumeId: volumes[volumes.length - 1]?.id ?? '',
      direction: '',
      eventId: '',
      stepIndex: 0,
      timelineSort: '',
      status: 'planned',
      tags: [],
      tagDraft: '',
    });
    setCreating(true);
  };

  const openEdit = (chapter: ChapterWithVolume) => {
    setForm({
      title: chapter.title,
      index: String(chapter.indexNo),
      volumeId: chapter.volumeId,
      direction: chapter.direction,
      eventId: chapter.eventId ?? '',
      stepIndex: chapter.stepIndex ?? 0,
      timelineSort: chapter.timelineSort ?? '',
      status: chapter.status,
      tags: (chapter.tags ?? []).map((tag) => tag.name),
      tagDraft: '',
    });
    setEditing(chapter);
  };

  const submitCreate = async () => {
    const index = form.index.trim() ? Number(form.index) : undefined;
    if (index !== undefined && (!Number.isInteger(index) || index < 1)) {
      toast.error(t('chapters.indexInvalid'));
      return;
    }
    // 标题留空时按序号自动命名，用户不必手写「第一章」这类汉字
    const title = form.title.trim() || (index ? `第${index}章` : t('chapters.untitled'));
    try {
      const result = await api.post<{ chapter: ChapterWithVolume }>(
        novelResourcePath(novelId, 'chapters'),
        { title, index, volumeId: form.volumeId, direction: form.direction },
      );
      if (form.tags.length > 0) {
        await api.patch(novelResourcePath(novelId, 'tags', result.chapter.id), { tags: form.tags });
      }
      toast.success(t('common.saved'));
      setCreating(false);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  const submitEdit = async () => {
    if (!editing) return;
    try {
      await api.patch(novelResourcePath(novelId, 'chapters', editing.id), {
        title: form.title,
        // 序号改动会触发同卷重排，留空表示不动
        indexNo: form.index.trim() ? Number(form.index) : undefined,
        status: form.status,
        eventId: form.eventId || null,
        stepIndex: form.stepIndex,
        timelineSort: form.timelineSort,
        direction: form.direction,
      });
      await api.patch(novelResourcePath(novelId, 'tags', editing.id), { tags: form.tags });
      toast.success(t('common.saved'));
      setEditing(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  /**
   * 把章节设为废案。
   *
   * 记录与正文都保留，只是移出正常目录，因此不需要二次确认；
   * 真正不可逆的是废案区里的彻底删除，那一步才弹确认框。
   */
  const scrapChapter = async (chapter: ChapterWithVolume) => {
    try {
      await api.patch(novelResourcePath(novelId, 'chapters', chapter.id), { action: 'scrap' });
      toast.success(t('chapters.scrapDone'));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  /** 还原废案。原位置被占用时服务端会拒绝并说明是哪一章占着。 */
  const restoreScrapped = async (chapter: ChapterWithVolume) => {
    try {
      await api.patch(novelResourcePath(novelId, 'chapters', chapter.id), { action: 'restore' });
      toast.success(t('chapters.restoreDone'));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  /** 确认设为废案。废案可在下方废案区还原或彻底删除。 */
  const confirmScrap = async () => {
    if (!pendingScrap) return;
    await scrapChapter(pendingScrap);
    setPendingScrap(null);
  };

  /** 彻底删除废案，连同正文文件。 */
  const purgeScrapped = async () => {
    if (!pendingPurge) return;
    try {
      await api.delete(novelResourcePath(novelId, 'chapters', pendingPurge.id));
      setPendingPurge(null);
      toast.success(t('common.saved'));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  const createVolume = async () => {
    try {
      await api.post(novelResourcePath(novelId, 'volumes'), { title: volumeForm.title });
      setNewVolumeOpen(false);
      setVolumeForm({ title: '' });
      await load();
      toast.success(t('common.saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  const removeVolume = async () => {
    if (!pendingVolumeDelete) return;
    try {
      await api.delete(novelResourcePath(novelId, 'volumes', pendingVolumeDelete.id));
      setPendingVolumeDelete(null);
      await load();
      toast.success(t('common.saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  const target = preferences?.targetWords ?? 3000;
  const tolerance = preferences?.wordTolerancePercent ?? 15;

  /** 依据事件标识取出事件标题，用于在章节行内标注所属事件。 */
  const eventTitle = (eventId: string | null) =>
    eventId ? (events.find((item) => item.id === eventId)?.title ?? '') : '';

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-soft">{t('chapters.title')}</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-muted">
            {t('chapters.hint')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as 'all' | ChapterStatus)}
            className="w-auto"
          >
            <option value="all">{t('common.all')}</option>
            {(['planned', 'drafting', 'generated', 'revised'] as ChapterStatus[]).map((status) => (
              <option key={status} value={status}>
                {t(`chapters.status.${status}`)}
              </option>
            ))}
          </Select>
          <Select
            value={tagFilter}
            onChange={(event) => setTagFilter(event.target.value)}
            className="w-auto"
          >
            <option value="">{t('search.tagFilter')}</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </Select>
          <Button onClick={() => setNewVolumeOpen(true)}>{t('chapters.newVolume')}</Button>
          <Button variant="primary" icon="fa-solid fa-plus" onClick={openCreate}>
            {t('chapters.newChapter')}
          </Button>
        </div>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Spinner /> {t('common.loading')}
        </div>
      ) : chapters.length === 0 ? (
        <Panel>
          <EmptyState
            title={t('common.empty')}
            hint={t('chapters.emptyHint')}
            action={
              <Button variant="primary" icon="fa-solid fa-plus" onClick={openCreate}>
                {t('chapters.newChapter')}
              </Button>
            }
          />
        </Panel>
      ) : (
        <div className="flex flex-col gap-4">
          {grouped.map(({ volume, chapters: list }) => (
            <Panel
              key={volume.id}
              title={`第${volume.indexNo}卷 ${volume.title}`}
              description={`${list.length} ${t('shelf.chaptersCount')} · ${formatNumber(
                list.reduce((sum, chapter) => sum + chapter.wordCount, 0),
              )} ${t('shelf.wordsCount')}`}
              actions={
                grouped.length > 1 ? (
                  <Button size="sm" variant="danger" onClick={() => setPendingVolumeDelete(volume)}>
                    <i className="fa-solid fa-trash-can" aria-hidden />
                  </Button>
                ) : undefined
              }
            >
              {list.length === 0 ? (
                <p className="text-xs text-ink-faint">本卷还没有章节。</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {list.map((chapter) => {
                    const delta = chapter.wordCount - target;
                    const withinTolerance = Math.abs(delta) <= (target * tolerance) / 100;
                    return (
                      <li key={chapter.id} className="flex flex-wrap items-center gap-3 py-2.5">
                        <span className="w-14 shrink-0 font-mono text-xs text-ink-faint">
                          {String(chapter.indexNo).padStart(3, '0')}
                        </span>
                        <Link
                          href={`/novels/${novelId}/chapters/${chapter.id}`}
                          className="min-w-0 flex-1 truncate text-sm text-soft transition-colors duration-200 hover:text-accent-strong"
                        >
                          {chapter.title}
                        </Link>
                        <span
                          className={clsx(
                            'chip shrink-0',
                            chapter.status === 'generated' && 'chip-accent',
                            chapter.status === 'revised' && 'text-ok',
                          )}
                        >
                          {t(`chapters.status.${chapter.status}`)}
                        </span>
                        <span className="hidden shrink-0 gap-1 sm:flex">
                          {(chapter.tags ?? []).map((tag) => (
                            <span key={tag.id} className="chip">
                              {tag.name}
                            </span>
                          ))}
                        </span>
                        {eventTitle(chapter.eventId) ? (
                          <span
                            className="chip hidden shrink-0 gap-1 lg:inline-flex"
                            title={t('chapters.stepIndex')}
                          >
                            <i className="fa-solid fa-flag text-[0.6rem]" aria-hidden />
                            {eventTitle(chapter.eventId)}
                            {chapter.stepIndex !== null ? ` #${chapter.stepIndex + 1}` : ''}
                          </span>
                        ) : null}
                        <span className="w-24 shrink-0 text-right text-xs text-ink-muted">
                          {formatNumber(chapter.wordCount)} / {formatNumber(target)}
                        </span>
                        <span className="hidden w-32 shrink-0 md:block">
                          <ProgressBar
                            value={chapter.wordCount}
                            max={Math.max(1, Math.round(target * 1.4))}
                          />
                          <span
                            className={clsx(
                              'mt-1 block text-[0.65rem]',
                              withinTolerance ? 'text-ok' : 'text-warn',
                            )}
                          >
                            {withinTolerance
                              ? t('chapters.withinTolerance')
                              : t('chapters.wordCountMismatch', {
                                  actual: chapter.wordCount,
                                  target,
                                  delta: Math.abs(delta),
                                })}
                          </span>
                        </span>
                        <div className="flex shrink-0 items-center gap-1">
                          <Link
                            href={`/novels/${novelId}/chapters/${chapter.id}`}
                            className="btn px-2 py-1 text-xs"
                          >
                            <i className="fa-solid fa-book-open" aria-hidden />
                          </Link>
                          <Link
                            href={`/novels/${novelId}/workbench?chapterId=${chapter.id}`}
                            className="btn px-2 py-1 text-xs"
                          >
                            <i className="fa-solid fa-wand-magic-sparkles" aria-hidden />
                          </Link>
                          <button
                            type="button"
                            className="btn px-2 py-1 text-xs"
                            onClick={() => openEdit(chapter)}
                            aria-label={t('common.edit')}
                          >
                            <i className="fa-solid fa-pen" aria-hidden />
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger px-2 py-1 text-xs"
                            onClick={() => setPendingScrap(chapter)}
                            aria-label={t('chapters.scrapChapter')}
                            title={t('chapters.scrapChapter')}
                          >
                            <i className="fa-solid fa-box-archive" aria-hidden />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          ))}
        </div>
      )}

      {/*
        废案区。这里的章节已经让出序号，不参与上面的卷章分组，
        可以在此还原回原位置，或彻底删除。
      */}
      <Panel
        title={t('chapters.scrappedSection')}
        description={t('chapters.scrappedHint')}
        actions={
          <Button size="sm" onClick={() => setScrapOpen((value) => !value)}>
            <i className={scrapOpen ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down'} aria-hidden />
            {scrapped.length}
          </Button>
        }
      >
        {scrapOpen ? (
          scrapped.length === 0 ? (
            <p className="text-xs text-ink-faint">{t('chapters.noScrapped')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {scrapped.map((chapter) => (
                <li
                  key={chapter.id}
                  className="flex flex-wrap items-center gap-2 rounded-[6px] border border-line px-3 py-2"
                >
                  <i className="fa-solid fa-box-archive text-[0.72rem] text-ink-faint" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-[0.86rem]">{chapter.title}</span>
                  <span className="chip">
                    {chapter.wordCount.toLocaleString('zh-Hans-CN')} {t('common.words')}
                  </span>
                  <Button size="sm" onClick={() => void restoreScrapped(chapter)}>
                    <i className="fa-solid fa-rotate-left" aria-hidden />
                    {t('chapters.restore')}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => setPendingPurge(chapter)}
                    aria-label={t('common.delete')}
                  >
                    <i className="fa-solid fa-trash-can" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </Panel>

      <Modal
        open={creating}
        title={t('chapters.newChapter')}
        onClose={() => setCreating(false)}
        footer={
          <>
            <Button onClick={() => setCreating(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={submitCreate}>
              {t('common.create')}
            </Button>
          </>
        }
      >
        <div className="grid gap-3.5">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label={t('chapters.chapterIndex')} hint={t('chapters.chapterIndexHint')}>
              <TextInput
                type="number"
                min={1}
                step={1}
                value={form.index}
                placeholder={t('chapters.chapterIndexPlaceholder')}
                onChange={(event) => setForm({ ...form, index: event.target.value })}
              />
            </Field>
            <Field label={t('chapters.chapterTitle')}>
              <TextInput
                value={form.title}
                placeholder={t('chapters.titleAutoHint')}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </Field>
          </div>
          <Field label={t('nav.chapters')}>
            <Select
              value={form.volumeId}
              onChange={(event) => setForm({ ...form, volumeId: event.target.value })}
            >
              {volumes.map((volume) => (
                <option key={volume.id} value={volume.id}>
                  第{volume.indexNo}卷 {volume.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('chapters.direction')} hint={t('chapters.directionHint')}>
            <TextArea
              rows={3}
              value={form.direction}
              onChange={(event) => setForm({ ...form, direction: event.target.value })}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={editing !== null}
        title={editing?.title ?? ''}
        size="lg"
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={submitEdit}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="grid gap-3.5">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label={t('chapters.chapterTitle')}>
              <TextInput
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </Field>
            <Field label={t('outline.nodeStatus')}>
              <Select
                value={form.status}
                onChange={(event) => setForm({ ...form, status: event.target.value as ChapterStatus })}
              >
                {(['planned', 'drafting', 'generated', 'revised'] as ChapterStatus[]).map((status) => (
                  <option key={status} value={status}>
                    {t(`chapters.status.${status}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={t('chapters.direction')} hint={t('chapters.directionHint')}>
            <TextArea
              rows={3}
              value={form.direction}
              onChange={(event) => setForm({ ...form, direction: event.target.value })}
            />
          </Field>
          <div className="grid gap-3.5 sm:grid-cols-[minmax(0,1fr)_8rem]">
            <Field label={t('chapters.event')} hint={t('chapters.eventHint')}>
              <Select
                value={form.eventId}
                onChange={(event) => setForm({ ...form, eventId: event.target.value })}
              >
                <option value="">{t('chapters.eventNone')}</option>
                {events.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('chapters.stepIndex')}>
              <TextInput
                type="number"
                min={0}
                value={form.stepIndex}
                onChange={(event) => setForm({ ...form, stepIndex: Number(event.target.value) })}
              />
            </Field>
          </div>
          <Field label={t('chapters.timelineTime')} hint={t('chapters.timelineTimeHint')}>
            <TextInput
              value={form.timelineSort}
              onChange={(event) => setForm({ ...form, timelineSort: event.target.value })}
            />
          </Field>
          <Field label={t('chapters.tags')} hint={t('chapters.tagPlaceholder')}>
            <div className="flex flex-wrap items-center gap-1.5">
              {form.tags.map((tag) => (
                <span key={tag} className="chip chip-accent">
                  {tag}
                  <button
                    type="button"
                    className="ml-0.5 opacity-60 hover:opacity-100"
                    onClick={() => setForm({ ...form, tags: form.tags.filter((item) => item !== tag) })}
                    aria-label={t('common.delete')}
                  >
                    <i className="fa-solid fa-xmark text-[0.7rem]" aria-hidden />
                  </button>
                </span>
              ))}
              <input
                value={form.tagDraft}
                placeholder={t('chapters.addTag')}
                onChange={(event) => setForm({ ...form, tagDraft: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ',') return;
                  event.preventDefault();
                  const value = form.tagDraft.trim();
                  if (!value || form.tags.includes(value)) return;
                  setForm({ ...form, tags: [...form.tags, value], tagDraft: '' });
                }}
                className="input w-40"
              />
            </div>
          </Field>
        </div>
      </Modal>

      <Modal
        open={newVolumeOpen}
        title={t('chapters.newVolume')}
        description={t('chapters.newVolumeConfirm')}
        size="sm"
        onClose={() => setNewVolumeOpen(false)}
        footer={
          <>
            <Button onClick={() => setNewVolumeOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={createVolume}>
              {t('common.create')}
            </Button>
          </>
        }
      >
        <Field label={t('chapters.volumeTitle')}>
          <TextInput
            value={volumeForm.title}
            placeholder={`第${volumes.length + 1}卷`}
            onChange={(event) => setVolumeForm({ title: event.target.value })}
          />
        </Field>
      </Modal>

      <ConfirmDialog
        open={pendingScrap !== null}
        title={t('chapters.scrapChapter')}
        message={t('chapters.scrapConfirm')}
        danger
        onCancel={() => setPendingScrap(null)}
        onConfirm={confirmScrap}
      />
      <ConfirmDialog
        open={pendingPurge !== null}
        title={t('common.delete')}
        message={t('chapters.purgeConfirm')}
        danger
        onCancel={() => setPendingPurge(null)}
        onConfirm={purgeScrapped}
      />
      <ConfirmDialog
        open={pendingVolumeDelete !== null}
        title={t('common.delete')}
        message={`${t('outline.deleteConfirm')}。${t('common.irreversible')}`}
        danger
        onCancel={() => setPendingVolumeDelete(null)}
        onConfirm={removeVolume}
      />
    </div>
  );
}
