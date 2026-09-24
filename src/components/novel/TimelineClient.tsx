'use client';

import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, novelResourcePath } from '@/lib/client/api';
import { useFormDraft } from '@/hooks/useFormDraft';
import { useSettings } from '@/components/providers/SettingsProvider';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import {
  Button,
  EmptyState,
  Field,
  Panel,
  Select,
  Spinner,
  TextArea,
  TextInput,
} from '@/components/ui/primitives';
import type { TimelineBranch, TimelineEvent } from '@/lib/types';

/** 时间轴。使用小说内历法串联事件，支持分叉、合并与跨分支引用。 */

interface EventsPayload {
  events: TimelineEvent[];
  branches: TimelineBranch[];
}

const EVENT_KINDS = ['plot', 'background', 'fork', 'merge'] as const;

export function TimelineClient({ novelId }: { novelId: string }) {
  const { t } = useSettings();
  const toast = useToast();

  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [branches, setBranches] = useState<TimelineBranch[]>([]);
  const [mainBranchId, setMainBranchId] = useState('');
  const [activeBranch, setActiveBranch] = useState('');
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'branch' | 'list'>('branch');
  const [editing, setEditing] = useState<TimelineEvent | null>(null);
  const [creating, setCreating] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TimelineEvent | null>(null);
  const [pendingBranchDelete, setPendingBranchDelete] = useState<TimelineBranch | null>(null);
  const [form, setForm] = useState({
    title: '',
    novelTime: '',
    description: '',
    impact: '',
    kind: 'plot' as TimelineEvent['kind'],
    branchId: '',
  });
  const [branchForm, setBranchForm] = useState({
    name: '',
    parentBranchId: '',
    forkEventId: '',
    description: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [eventResult, branchResult] = await Promise.all([
        api.get<EventsPayload>(novelResourcePath(novelId, 'timeline-events')),
        api.get<{ branches: TimelineBranch[]; mainBranchId: string }>(
          novelResourcePath(novelId, 'timeline-branches'),
        ),
      ]);
      setEvents(eventResult.events);
      setBranches(branchResult.branches);
      setMainBranchId(branchResult.mainBranchId);
      setActiveBranch((current) => current || branchResult.mainBranchId);
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

  const byBranch = useMemo(() => {
    const map = new Map<string, TimelineEvent[]>();
    for (const event of events) {
      const list = map.get(event.branchId) ?? [];
      list.push(event);
      map.set(event.branchId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.orderNo - b.orderNo);
    return map;
  }, [events]);

  /** 弹窗表单的草稿，页面切换后回来接着改。 */
  const formDraft = useFormDraft({
    scope: `${novelId}:timeline`,
    targetId: editing?.id ?? null,
    open: creating || editing !== null,
    value: form,
  });

  const openCreate = (branchId?: string) => {
    const cached = formDraft.restore('new');
    if (cached) {
      setForm(cached);
      setCreating(true);
      return;
    }
    setForm({
      title: '',
      novelTime: '',
      description: '',
      impact: '',
      kind: 'plot',
      branchId: branchId ?? activeBranch ?? mainBranchId,
    });
    setCreating(true);
  };

  const openEdit = (event: TimelineEvent) => {
    const cached = formDraft.restore(event.id);
    if (cached) setForm(cached);
    else
      setForm({
        title: event.title,
        novelTime: event.novelTime,
        description: event.description,
        impact: event.impact,
        kind: event.kind,
        branchId: event.branchId,
      });
    setEditing(event);
  };

  const submitEvent = async () => {
    if (!form.title.trim()) {
      toast.error(t('common.required'));
      return;
    }
    try {
      if (editing) {
        await api.patch(novelResourcePath(novelId, 'timeline-events', editing.id), form);
        setEditing(null);
      } else {
        await api.post(novelResourcePath(novelId, 'timeline-events'), form);
        setCreating(false);
      }
      toast.success(t('common.saved'));
      formDraft.clear();
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  const submitBranch = async () => {
    if (!branchForm.name.trim()) {
      toast.error(t('common.required'));
      return;
    }
    try {
      await api.post(novelResourcePath(novelId, 'timeline-branches'), branchForm);
      setBranchOpen(false);
      setBranchForm({ name: '', parentBranchId: '', forkEventId: '', description: '' });
      await load();
      toast.success(t('common.saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  const removeEvent = async () => {
    if (!pendingDelete) return;
    try {
      await api.delete(novelResourcePath(novelId, 'timeline-events', pendingDelete.id));
      setPendingDelete(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  const removeBranch = async () => {
    if (!pendingBranchDelete) return;
    try {
      await api.delete(novelResourcePath(novelId, 'timeline-branches', pendingBranchDelete.id));
      setPendingBranchDelete(null);
      setActiveBranch(mainBranchId);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  /** 合并分支：把合并点事件标记出来，表示该分支回到主线。 */
  const mergeBranch = async (branch: TimelineBranch, mergeEventId: string) => {
    try {
      await api.patch(novelResourcePath(novelId, 'timeline-branches', branch.id), { mergeEventId });
      await load();
      toast.success(t('common.saved'));
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

  const branchName = (id: string) => branches.find((branch) => branch.id === id)?.name ?? '';

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-soft">{t('timeline.title')}</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-muted">
            {t('timeline.hint')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-[6px] border border-line">
            {(['branch', 'list'] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setView(item)}
                className={clsx(
                  'px-3 py-1.5 text-xs transition-colors duration-200',
                  view === item
                    ? 'bg-accent-soft font-semibold text-accent-strong'
                    : 'bg-surface-raised text-ink-muted hover:bg-surface-soft',
                )}
              >
                {item === 'branch' ? t('timeline.branchView') : t('timeline.listView')}
              </button>
            ))}
          </div>
          <Button onClick={() => setBranchOpen(true)}>
            <i className="fa-solid fa-code-branch" aria-hidden />
            {t('timeline.newBranch')}
          </Button>
          <Button variant="primary" icon="fa-solid fa-plus" onClick={() => openCreate()}>
            {t('timeline.newEvent')}
          </Button>
        </div>
      </header>

      {events.length === 0 ? (
        <Panel>
          <EmptyState
            icon="fa-solid fa-timeline"
            title={t('common.empty')}
            hint={t('timeline.emptyHint')}
            action={
              <Button variant="primary" icon="fa-solid fa-plus" onClick={() => openCreate()}>
                {t('timeline.newEvent')}
              </Button>
            }
          />
        </Panel>
      ) : view === 'branch' ? (
        <div className="flex flex-col gap-4">
          {branches.map((branch) => {
            const list = byBranch.get(branch.id) ?? [];
            const parent = branch.parentBranchId ? branchName(branch.parentBranchId) : '';
            return (
              <Panel
                key={branch.id}
                title={
                  branch.isMain ? `${branch.name} · ${t('timeline.mainBranch')}` : branch.name
                }
                description={[
                  parent ? `自 ${parent} 分叉` : '',
                  branch.mergeEventId
                    ? `合并于 ${list.find((item) => item.id === branch.mergeEventId)?.title ?? '未知事件'}`
                    : '',
                  branch.description,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                actions={
                  <>
                    <Button size="sm" onClick={() => openCreate(branch.id)}>
                      <i className="fa-solid fa-plus" aria-hidden />
                    </Button>
                    {!branch.isMain ? (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => setPendingBranchDelete(branch)}
                      >
                        <i className="fa-solid fa-trash-can" aria-hidden />
                      </Button>
                    ) : null}
                  </>
                }
              >
                {list.length === 0 ? (
                  <p className="text-xs text-ink-faint">该分支还没有事件。</p>
                ) : (
                  <ol className="relative flex flex-col gap-3 pl-6">
                    <span className="absolute top-2 bottom-2 left-[7px] w-px bg-line" />
                    {list.map((event) => (
                      <li key={event.id} className="relative">
                        <span
                          className={clsx(
                            'absolute top-1.5 -left-6 h-3 w-3 rounded-full border-2 bg-surface-raised',
                            event.kind === 'fork' && 'border-warn',
                            event.kind === 'merge' && 'border-ok',
                            event.kind === 'plot' && 'border-accent',
                            event.kind === 'background' && 'border-line-strong',
                          )}
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-ink-faint">
                            {event.novelTime || '时间待定'}
                          </span>
                          <span className="text-sm font-medium text-soft">{event.title}</span>
                          <span className="chip">{t(`timeline.kindLabels.${event.kind}`)}</span>
                          {event.chapterId ? (
                            <a
                              href={`/novels/${novelId}/chapters/${event.chapterId}`}
                              className="chip chip-accent"
                            >
                              {t('timeline.linkedChapter')}
                            </a>
                          ) : null}
                          {branch.isMain ? null : (
                            <button
                              type="button"
                              className="chip transition-colors duration-200 hover:border-accent-border hover:text-accent-strong"
                              onClick={() => void mergeBranch(branch, event.id)}
                            >
                              {t('timeline.mergeHint')}
                            </button>
                          )}
                          <span className="ml-auto flex items-center gap-1">
                            <Button size="sm" onClick={() => openEdit(event)}>
                              <i className="fa-solid fa-pen" aria-hidden />
                            </Button>
                            <Button size="sm" variant="danger" onClick={() => setPendingDelete(event)}>
                              <i className="fa-solid fa-trash-can" aria-hidden />
                            </Button>
                          </span>
                        </div>
                        {event.description ? (
                          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                            {event.description}
                          </p>
                        ) : null}
                        {event.impact ? (
                          <p className="mt-1 text-xs leading-relaxed text-ink-faint">
                            {t('timeline.impact')}：{event.impact}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
              </Panel>
            );
          })}
        </div>
      ) : (
        <Panel title={t('timeline.listView')}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Select
              value={activeBranch}
              onChange={(event) => setActiveBranch(event.target.value)}
              className="w-auto"
            >
              <option value="">{t('common.all')}</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </Select>
            <span className="text-xs text-ink-faint">
              {t('timeline.crossBranch')}：{branches.length}
            </span>
          </div>
          <ul className="flex flex-col divide-y divide-line">
            {events
              .filter((event) => !activeBranch || event.branchId === activeBranch)
              .map((event) => (
                <li key={event.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="w-32 shrink-0 font-mono text-xs text-ink-faint">
                    {event.novelTime || '时间待定'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-soft">{event.title}</span>
                  <span className="chip">{branchName(event.branchId)}</span>
                  <span className="chip">{t(`timeline.kindLabels.${event.kind}`)}</span>
                  <div className="flex items-center gap-1">
                    <Button size="sm" onClick={() => openEdit(event)}>
                      <i className="fa-solid fa-pen" aria-hidden />
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => setPendingDelete(event)}>
                      <i className="fa-solid fa-trash-can" aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
          </ul>
        </Panel>
      )}

      <Modal
        open={creating || editing !== null}
        title={editing ? t('common.edit') : t('timeline.newEvent')}
        size="lg"
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        footer={
          <>
            <Button
              onClick={() => {
                setCreating(false);
                setEditing(null);
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={submitEvent}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="grid gap-3.5">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label={t('timeline.eventTitle')} required>
              <TextInput
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
              />
            </Field>
            <Field label={t('timeline.novelTime')}>
              <TextInput
                value={form.novelTime}
                onChange={(event) => setForm({ ...form, novelTime: event.target.value })}
              />
            </Field>
          </div>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label={t('timeline.newBranch')}>
              <Select
                value={form.branchId}
                onChange={(event) => setForm({ ...form, branchId: event.target.value })}
              >
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('timeline.kind')}>
              <Select
                value={form.kind}
                onChange={(event) =>
                  setForm({ ...form, kind: event.target.value as TimelineEvent['kind'] })
                }
              >
                {EVENT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`timeline.kindLabels.${kind}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={t('timeline.eventDescription')}>
            <TextArea
              rows={5}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </Field>
          <Field label={t('timeline.impact')}>
            <TextArea
              rows={3}
              value={form.impact}
              onChange={(event) => setForm({ ...form, impact: event.target.value })}
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={branchOpen}
        title={t('timeline.newBranch')}
        size="sm"
        onClose={() => setBranchOpen(false)}
        footer={
          <>
            <Button onClick={() => setBranchOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={submitBranch}>
              {t('common.create')}
            </Button>
          </>
        }
      >
        <div className="grid gap-3.5">
          <Field label={t('timeline.branchName')} required>
            <TextInput
              value={branchForm.name}
              onChange={(event) => setBranchForm({ ...branchForm, name: event.target.value })}
            />
          </Field>
          <Field label={t('timeline.parentBranch')}>
            <Select
              value={branchForm.parentBranchId}
              onChange={(event) =>
                setBranchForm({ ...branchForm, parentBranchId: event.target.value })
              }
            >
              <option value="">{t('common.none')}</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('timeline.forkEvent')}>
            <Select
              value={branchForm.forkEventId}
              onChange={(event) => setBranchForm({ ...branchForm, forkEventId: event.target.value })}
            >
              <option value="">{t('common.none')}</option>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.novelTime ? `${event.novelTime} · ` : ''}
                  {event.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('timeline.description')}>
            <TextArea
              rows={3}
              value={branchForm.description}
              onChange={(event) =>
                setBranchForm({ ...branchForm, description: event.target.value })
              }
            />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('common.delete')}
        message={t('timeline.deleteEventConfirm')}
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={removeEvent}
      />
      <ConfirmDialog
        open={pendingBranchDelete !== null}
        title={t('common.delete')}
        message={t('timeline.deleteBranchConfirm')}
        danger
        onCancel={() => setPendingBranchDelete(null)}
        onConfirm={removeBranch}
      />
    </div>
  );
}
