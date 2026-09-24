'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, novelResourcePath } from '@/lib/client/api';
import { useSettings } from '@/components/providers/SettingsProvider';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import {
  Button,
  EmptyState,
  Field,
  Panel,
  Spinner,
  TextArea,
  TextInput,
  Toggle,
} from '@/components/ui/primitives';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { deriveStepsFromOutline } from '@/lib/markdown/outline';
import { clearDraftValue, readDraftValue, writeDraftValue } from '@/hooks/useDraftState';
import type { StoryEvent, StoryEventListPayload, StoryEventStatus } from '@/lib/types';

/** 事件大纲页。按状态分组展示全部故事事件及其大纲步骤与推进进度。 */

const STATUS_ORDER: StoryEventStatus[] = ['writing', 'active', 'done', 'archived'];

/** 手动新建事件的表单初值。 */
const EMPTY_NEW_EVENT = { title: '', outline: '', novelTime: '', notes: '' };

export function EventsClient({ novelId }: { novelId: string }) {
  const { t } = useSettings();
  const toast = useToast();

  const [events, setEvents] = useState<StoryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<StoryEvent | null>(null);
  /** 正在编辑大纲的事件 */
  const [outlineEditing, setOutlineEditing] = useState<StoryEvent | null>(null);
  /** 大纲编辑草稿 */
  const [outlineDraft, setOutlineDraft] = useState('');
  /** 保存大纲时是否按新文本重推推进步骤 */
  const [rederiveSteps, setRederiveSteps] = useState(false);
  const [savingOutline, setSavingOutline] = useState(false);
  /** 手动新建事件 */
  const [newEventOpen, setNewEventOpen] = useState(false);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [newEvent, setNewEvent] = useState(EMPTY_NEW_EVENT);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 集合地址返回事件、当前事件与已完成事件三部分，这里只需要事件清单
      const payload = await api.get<StoryEventListPayload>(
        novelResourcePath(novelId, 'story-events'),
      );
      setEvents(payload.events ?? []);
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

  const advance = async (event: StoryEvent, stepsForward: number) => {
    try {
      await api.patch(novelResourcePath(novelId, 'story-events', event.id), {
        advance: stepsForward,
      });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    try {
      await api.delete(novelResourcePath(novelId, 'story-events', pendingDelete.id));
      setPendingDelete(null);
      toast.success(t('common.saved'));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  /*
   * 事件大纲的直接编辑。
   *
   * 事件大纲此前只能由模型生成，或在生成时用指令改动，
   * 想调整某句话就得重跑一次生成。这里补上直接改文本的入口。
   *
   * 步骤清单默认不动：步骤上可能已经有用户调整过的时间与细节，
   * 重推会丢掉这些内容，因此只在用户明确要求时才按新大纲重推。
   */
  /** 新建表单的更新入口，顺带把内容落到草稿。 */
  const updateNewEvent = (patch: Partial<typeof EMPTY_NEW_EVENT>) => {
    setNewEvent((current) => {
      const next = { ...current, ...patch };
      writeDraftValue(`${novelId}:events:new`, next);
      return next;
    });
  };

  /** 打开新建弹窗，有草稿就接着上次写。 */
  const openNewEvent = () => {
    const cached = readDraftValue<typeof EMPTY_NEW_EVENT>(`${novelId}:events:new`);
    setNewEvent(cached ?? EMPTY_NEW_EVENT);
    setNewEventOpen(true);
  };

  /** 手动新建事件。
   *
   * 事件原先只能由工作台生成，想自己写一段大纲没有入口。
   * 这里允许直接写标题与大纲正文，推进步骤由服务端从文本推导；
   * 弹窗里实时显示能推导出多少步，写完就知道能不能立起来。
   */
  const createEvent = async () => {
    const outline = newEvent.outline.trim();
    if (!outline) {
      toast.error(t('events.outlineRequired'));
      return;
    }
    setCreatingEvent(true);
    try {
      await api.post(novelResourcePath(novelId, 'story-events'), {
        title: newEvent.title,
        outline,
        novelTime: newEvent.novelTime,
        notes: newEvent.notes,
      });
      setNewEventOpen(false);
      setNewEvent(EMPTY_NEW_EVENT);
      clearDraftValue(`${novelId}:events:new`);
      toast.success(t('common.saved'));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    } finally {
      setCreatingEvent(false);
    }
  };

  /** 新建弹窗里当前大纲能推导出的步骤，给用户即时反馈。 */
  const newEventSteps = deriveStepsFromOutline(newEvent.outline);

  const openOutlineEdit = (event: StoryEvent) => {
    setOutlineEditing(event);
    /*
     * 打开时优先恢复草稿。
     * 弹窗不是独立组件，挂不了 hook，所以手动读写：
     * 上次改到一半切走了页面，这次打开还能接着改。
     */
    const cached = readDraftValue<string>(`${novelId}:events:outline:${event.id}`);
    setOutlineDraft(cached ?? event.outline ?? '');
    setRederiveSteps(false);
  };

  /** 编辑大纲正文时同步落草稿，切换页面后回来还在。 */
  const onOutlineDraftChange = (value: string) => {
    setOutlineDraft(value);
    if (outlineEditing) writeDraftValue(`${novelId}:events:outline:${outlineEditing.id}`, value);
  };

  const saveOutline = async () => {
    if (!outlineEditing) return;
    const text = outlineDraft.trim();
    if (!text) {
      toast.error(t('common.required'));
      return;
    }
    setSavingOutline(true);
    try {
      const payload: Record<string, unknown> = { outline: text };
      if (rederiveSteps) {
        const steps = deriveStepsFromOutline(text);
        if (steps.length === 0) {
          toast.error(t('events.rederiveFailed'));
          setSavingOutline(false);
          return;
        }
        payload.steps = steps.map((step) => ({
          title: step.title,
          detail: step.detail,
          novelTime: step.novelTime,
        }));
      }
      await api.patch(novelResourcePath(novelId, 'story-events', outlineEditing.id), payload);
      // 已落库，草稿可以清掉
      clearDraftValue(`${novelId}:events:outline:${outlineEditing.id}`);
      setOutlineEditing(null);
      toast.success(t('common.saved'));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    } finally {
      setSavingOutline(false);
    }
  };

  const grouped = STATUS_ORDER.map((status) => ({
    status,
    items: events.filter((event) => event.status === status),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-soft">{t('events.title')}</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-muted">
            {t('events.hint')}
          </p>
        </div>
        <Button onClick={openNewEvent}>
          <i className="fa-solid fa-plus" aria-hidden />
          {t('events.newEvent')}
        </Button>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Spinner /> {t('common.loading')}
        </div>
      ) : events.length === 0 ? (
        <Panel>
          <EmptyState
            title={t('common.empty')}
            hint={t('events.emptyHint')}
            action={
              <Link href={`/novels/${novelId}/workbench`} className="btn btn-primary">
                <i className="fa-solid fa-wand-magic-sparkles" aria-hidden />
                {t('nav.workbench')}
              </Link>
            }
          />
        </Panel>
      ) : (
        <div className="flex flex-col gap-4">
          {grouped.map(({ status, items }) => (
            <Panel key={status} title={t(`events.status.${status}`)} description={`${items.length}`}>
              <ul className="flex flex-col gap-3">
                {items.map((event) => {
                  const open = expanded === event.id;
                  const finished = event.steps.length > 0 && event.progress >= event.steps.length;
                  return (
                    <li key={event.id} className="card flex flex-col gap-3 p-3.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setExpanded(open ? null : event.id)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <i
                            className={clsx(
                              'fa-solid fa-chevron-right shrink-0 text-[0.68rem] text-ink-faint transition-transform duration-200',
                              open && 'rotate-90',
                            )}
                            aria-hidden
                          />
                          <span className="truncate text-sm font-medium text-soft">
                            {event.title}
                          </span>
                        </button>
                        {event.novelTime ? (
                          <span className="chip shrink-0">{event.novelTime}</span>
                        ) : null}
                        <span className={clsx('chip shrink-0', finished && 'text-ok')}>
                          {t('events.progress')} {event.progress}/{event.steps.length}
                        </span>
                        <span className="chip shrink-0">{t(`events.status.${event.status}`)}</span>
                      </div>

                      {open ? (
                        <>
                          {event.userChoice ? (
                            <p className="text-[0.68rem] leading-relaxed text-ink-faint">
                              {t('events.userChoice')}：{event.userChoice}
                            </p>
                          ) : null}

                          {event.steps.length > 0 ? (
                            <ol className="flex flex-col gap-1.5">
                              {event.steps.map((step, position) => (
                                <li
                                  key={`${step.title}-${position}`}
                                  className={clsx(
                                    'flex items-start gap-2 rounded-md border border-line px-2.5 py-1.5 text-xs',
                                    position < event.progress && 'text-ok',
                                    position === event.progress &&
                                      'border-accent-border bg-accent-soft text-soft',
                                    position > event.progress && 'text-ink-faint',
                                  )}
                                >
                                  <span className="font-mono text-[0.65rem] text-ink-faint">
                                    {String(position + 1).padStart(2, '0')}
                                  </span>
                                  <span className="min-w-0 flex-1 leading-relaxed">
                                    {step.title}
                                  </span>
                                  {step.novelTime ? (
                                    <span className="shrink-0 text-[0.65rem] text-ink-faint">
                                      {step.novelTime}
                                    </span>
                                  ) : null}
                                </li>
                              ))}
                            </ol>
                          ) : null}

                          {event.outline ? (
                            <div className="card max-h-96 overflow-y-auto px-4 py-3">
                              <MarkdownView content={event.outline} />
                            </div>
                          ) : null}

                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void advance(event, -1)}
                              disabled={event.progress <= 0}
                            >
                              <i className="fa-solid fa-chevron-left" aria-hidden />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void advance(event, 1)}
                              disabled={finished}
                            >
                              <i className="fa-solid fa-chevron-right" aria-hidden />
                            </Button>
                            <Link
                              href={`/novels/${novelId}/workbench`}
                              className="btn btn-ghost px-2 py-1 text-xs"
                            >
                              <i className="fa-solid fa-wand-magic-sparkles" aria-hidden />
                            </Link>
                            <Button
                              size="sm"
                              onClick={() => openOutlineEdit(event)}
                              title={t('events.editOutline')}
                            >
                              <i className="fa-solid fa-pen" aria-hidden />
                              <span className="hidden sm:inline">{t('events.editOutline')}</span>
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              className="ml-auto"
                              onClick={() => setPendingDelete(event)}
                            >
                              {t('common.delete')}
                            </Button>
                          </div>
                        </>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ))}
        </div>
      )}

      <Modal
        open={newEventOpen}
        title={t('events.newEvent')}
        description={t('events.newEventHint')}
        size="xl"
        onClose={() => setNewEventOpen(false)}
        footer={
          <>
            <Button onClick={() => setNewEventOpen(false)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              onClick={createEvent}
              disabled={creatingEvent || !newEvent.outline.trim()}
            >
              {creatingEvent ? <Spinner /> : <i className="fa-solid fa-check" aria-hidden />}
              {t('common.create')}
            </Button>
          </>
        }
      >
        <div className="grid gap-3.5">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label={t('events.eventTitle')} hint={t('events.titleOptionalHint')}>
              <TextInput
                value={newEvent.title}
                placeholder={t('events.titleFromOutline')}
                onChange={(event) => updateNewEvent({ title: event.target.value })}
              />
            </Field>
            <Field label={t('events.novelTime')}>
              <TextInput
                value={newEvent.novelTime}
                onChange={(event) => updateNewEvent({ novelTime: event.target.value })}
              />
            </Field>
          </div>
          <Field label={t('events.outlineContent')} required>
            <TextArea
              rows={14}
              value={newEvent.outline}
              placeholder={t('events.outlinePlaceholder')}
              onChange={(event) => updateNewEvent({ outline: event.target.value })}
            />
          </Field>
          <Field label={t('setup.notes')}>
            <TextArea
              rows={2}
              value={newEvent.notes}
              onChange={(event) => updateNewEvent({ notes: event.target.value })}
            />
          </Field>

          {/* 推进步骤由大纲推导，这里先把结果亮出来 */}
          <div className="rounded-[8px] border border-[var(--glass-border)] bg-surface-soft px-3.5 py-2.5">
            <p className="text-sm font-semibold text-soft">
              {t('events.derivedSteps')}
              <span className="ml-2 text-xs font-normal text-ink-faint">
                {newEventSteps.length}
              </span>
            </p>
            {newEventSteps.length === 0 ? (
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                {t('events.derivedStepsEmpty')}
              </p>
            ) : (
              <ol className="mt-1.5 flex flex-col gap-1">
                {newEventSteps.map((step, index) => (
                  <li key={index} className="flex gap-2 text-xs leading-relaxed text-ink-muted">
                    <span className="shrink-0 font-mono text-ink-faint">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="min-w-0 flex-1">{step.title}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        open={outlineEditing !== null}
        title={t('events.editOutline')}
        description={t('events.editOutlineHint')}
        size="xl"
        onClose={() => setOutlineEditing(null)}
        footer={
          <>
            <Button onClick={() => setOutlineEditing(null)}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={saveOutline} disabled={savingOutline}>
              {savingOutline ? <Spinner /> : <i className="fa-solid fa-floppy-disk" aria-hidden />}
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="grid gap-3.5">
          <Field label={t('events.outlineContent')} hint={t('events.outlineContentHint')}>
            <TextArea
              rows={18}
              value={outlineDraft}
              onChange={(event) => onOutlineDraftChange(event.target.value)}
            />
          </Field>
          <Toggle
            checked={rederiveSteps}
            onChange={setRederiveSteps}
            label={t('events.rederiveSteps')}
            hint={t('events.rederiveStepsHint')}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('common.delete')}
        message={`${t('outline.deleteConfirm')}。${t('common.irreversible')}`}
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={remove}
      />
    </div>
  );
}
