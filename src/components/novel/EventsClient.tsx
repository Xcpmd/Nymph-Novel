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
  Toggle,
} from '@/components/ui/primitives';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { deriveStepsFromOutline } from '@/lib/markdown/outline';
import type { StoryEvent, StoryEventListPayload, StoryEventStatus } from '@/lib/types';

/** 事件大纲页。按状态分组展示全部故事事件及其大纲步骤与推进进度。 */

const STATUS_ORDER: StoryEventStatus[] = ['writing', 'active', 'done', 'archived'];

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
  const openOutlineEdit = (event: StoryEvent) => {
    setOutlineEditing(event);
    setOutlineDraft(event.outline ?? '');
    setRederiveSteps(false);
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
      <header>
        <h1 className="text-lg font-semibold text-soft">{t('events.title')}</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-muted">{t('events.hint')}</p>
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
              onChange={(event) => setOutlineDraft(event.target.value)}
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
