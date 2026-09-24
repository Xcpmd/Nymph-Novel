'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
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
  Spinner,
  Select,
  TextArea,
  TextInput,
} from '@/components/ui/primitives';
import { useGeneration } from '@/hooks/useGeneration';
import { BudgetConfirmPrompt } from './BudgetConfirmPrompt';
import type { OutlineKind, OutlineNode, OutlineStatus } from '@/lib/types';

/** 大纲编辑器。支持逐级展开、增删改与同级排序。 */

interface OutlinePayload {
  nodes: OutlineNode[];
  overview: string;
}

const KINDS: OutlineKind[] = ['arc', 'beat', 'sub'];
const STATUSES: OutlineStatus[] = ['planned', 'active', 'done'];

export function OutlineClient({ novelId }: { novelId: string }) {
  const { t } = useSettings();
  const toast = useToast();

  const [tree, setTree] = useState<OutlineNode[]>([]);
  const [overview, setOverview] = useState('');
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<OutlineNode | null>(null);
  const [parentForNew, setParentForNew] = useState<string | null | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<OutlineNode | null>(null);
  /** 正在用 AI 撰写内容的节点 */
  const [aiNode, setAiNode] = useState<OutlineNode | null>(null);
  /** 交给模型的补充要求 */
  const [aiAsk, setAiAsk] = useState('');

  const generation = useGeneration();
  const [savingOverview, setSavingOverview] = useState(false);

  const [form, setForm] = useState<{ title: string; content: string; kind: OutlineKind; status: OutlineStatus }>({
    title: '',
    content: '',
    kind: 'beat',
    status: 'planned',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<OutlinePayload>(novelResourcePath(novelId, 'outline'));
      setTree(result.nodes);
      setOverview(result.overview);
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

  const formDraft = useFormDraft({
    scope: `${novelId}:outline`,
    targetId: editing?.id ?? null,
    open: editing !== null || parentForNew !== undefined,
    value: form,
  });

  const openCreate = (parentId: string | null) => {
    const cached = formDraft.restore(parentId ? `new:${parentId}` : 'new');
    if (cached) setForm(cached);
    else setForm({ title: '', content: '', kind: parentId ? 'sub' : 'arc', status: 'planned' });
    setParentForNew(parentId);
  };

  const openEdit = (node: OutlineNode) => {
    const cached = formDraft.restore(node.id);
    if (cached) setForm(cached);
    else setForm({ title: node.title, content: node.content, kind: node.kind, status: node.status });
    setEditing(node);
  };

  const submit = async () => {
    if (!form.title.trim()) {
      toast.error(t('common.required'));
      return;
    }
    try {
      if (editing) {
        await api.patch(novelResourcePath(novelId, 'outline', editing.id), form);
        setEditing(null);
      } else {
        await api.post(novelResourcePath(novelId, 'outline'), {
          ...form,
          parentId: parentForNew ?? null,
        });
        setParentForNew(undefined);
      }
      toast.success(t('common.saved'));
      formDraft.clear();
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  /*
   * 用 AI 撰写节点内容。
   *
   * 节点信息经 instruction 一并交给模型：提示词模板里没有为节点准备独立变量，
   * 与其为此扩展上下文变量表，不如在这里拼装，模板保持通用。
   */
  const openNodeAi = (node: OutlineNode) => {
    setAiNode(node);
    setAiAsk('');
  };

  const runNodeAi = async () => {
    if (!aiNode) return;
    const instruction = [
      `节点标题：${aiNode.title}`,
      `节点类型：${t(`outline.kind${aiNode.kind === 'arc' ? 'Arc' : aiNode.kind === 'beat' ? 'Beat' : 'Sub'}`)}`,
      `节点现有内容：${aiNode.content || '（空）'}`,
      aiAsk.trim() ? `补充要求：${aiAsk.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    await generation.start({
      novelId,
      taskType: 'outline_node_write',
      instruction,
    });
  };

  /** 把生成结果写入节点内容。 */
  const applyNodeResult = async () => {
    if (!aiNode) return;
    const text = generation.text.trim();
    if (!text) return;
    try {
      await api.patch(novelResourcePath(novelId, 'outline', aiNode.id), { content: text });
      setAiNode(null);
      setAiAsk('');
      toast.success(t('common.saved'));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    try {
      await api.delete(novelResourcePath(novelId, 'outline', pendingDelete.id));
      setPendingDelete(null);
      toast.success(t('common.saved'));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  const move = async (node: OutlineNode, direction: -1 | 1, siblings: OutlineNode[]) => {
    const index = siblings.findIndex((item) => item.id === node.id);
    const target = index + direction;
    if (target < 0 || target >= siblings.length) return;
    const reordered = [...siblings];
    const swapped = reordered[index]!;
    reordered[index] = reordered[target]!;
    reordered[target] = swapped;
    try {
      await api.patch(novelResourcePath(novelId, 'outline', node.id), {
        orderedIds: reordered.map((item) => item.id),
      });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  const saveOverview = async () => {
    setSavingOverview(true);
    try {
      await api.patch(novelResourcePath(novelId, 'preferences'), { outlineOverview: overview });
      toast.success(t('common.saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    } finally {
      setSavingOverview(false);
    }
  };

  const renderNodes = (nodes: OutlineNode[], depth = 0) => (
    <ul className={clsx('flex flex-col gap-1', depth > 0 && 'ml-4 border-l border-line pl-3')}>
      {nodes.map((node) => {
        const isCollapsed = collapsed.has(node.id);
        const hasChildren = (node.children?.length ?? 0) > 0;
        return (
          <li key={node.id}>
            <div className="group flex items-start gap-2 rounded-[6px] px-2 py-1.5 transition-colors duration-200 hover:bg-surface-soft">
              <button
                type="button"
                onClick={() =>
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(node.id)) next.delete(node.id);
                    else next.add(node.id);
                    return next;
                  })
                }
                className={clsx(
                  'mt-0.5 w-4 shrink-0 text-[0.7rem] text-ink-faint transition-transform duration-200',
                  !hasChildren && 'invisible',
                  isCollapsed && '-rotate-90',
                )}
                aria-label={isCollapsed ? t('common.expand') : t('common.collapse')}
              >
                <i className="fa-solid fa-chevron-down" aria-hidden />
              </button>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-soft">{node.title}</span>
                  <span className="chip">{t(`outline.kind${node.kind === 'arc' ? 'Arc' : node.kind === 'beat' ? 'Beat' : 'Sub'}`)}</span>
                  <span
                    className={clsx(
                      'chip',
                      node.status === 'done' && 'text-ok',
                      node.status === 'active' && 'chip-accent',
                    )}
                  >
                    {t(`outline.status${node.status === 'planned' ? 'Planned' : node.status === 'active' ? 'Active' : 'Done'}`)}
                  </span>
                </div>
                {node.content ? (
                  <p className="mt-1 text-xs leading-relaxed text-ink-muted">{node.content}</p>
                ) : null}
              </div>

              <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100">
                <button
                  type="button"
                  className="btn btn-ghost px-1.5 py-1"
                  onClick={() => void move(node, -1, nodes)}
                  aria-label={t('chapters.moveUp')}
                >
                  <i className="fa-solid fa-arrow-up text-[0.7rem]" aria-hidden />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost px-1.5 py-1"
                  onClick={() => void move(node, 1, nodes)}
                  aria-label={t('chapters.moveDown')}
                >
                  <i className="fa-solid fa-arrow-down text-[0.7rem]" aria-hidden />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost px-1.5 py-1"
                  onClick={() => openCreate(node.id)}
                  aria-label={t('outline.addChild')}
                >
                  <i className="fa-solid fa-plus text-[0.7rem]" aria-hidden />
                </button>
                  <button
                    type="button"
                    className="btn btn-ghost px-1.5 py-1"
                    onClick={() => openNodeAi(node)}
                    aria-label={t('outline.nodeAi')}
                    title={t('outline.nodeAi')}
                  >
                    <i className="fa-solid fa-wand-magic-sparkles text-[0.7rem]" aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost px-1.5 py-1"
                    onClick={() => openEdit(node)}
                    aria-label={t('common.edit')}
                  >
                  <i className="fa-solid fa-pen text-[0.7rem]" aria-hidden />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost px-1.5 py-1 text-danger"
                  onClick={() => setPendingDelete(node)}
                  aria-label={t('common.delete')}
                >
                  <i className="fa-solid fa-trash-can text-[0.7rem]" aria-hidden />
                </button>
              </div>
            </div>
            {hasChildren && !isCollapsed ? renderNodes(node.children!, depth + 1) : null}
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-soft">{t('outline.title')}</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-muted">
            {t('outline.hint')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button icon="fa-solid fa-plus" onClick={() => openCreate(null)}>
            {t('outline.addRoot')}
          </Button>
          <Link href={`/novels/${novelId}/workbench`} className="btn btn-primary">
            <i className="fa-solid fa-wand-magic-sparkles" aria-hidden />
            {t('nav.workbench')}
          </Link>
        </div>
      </header>

      <Panel title={t('setup.outlineOverview')} description={t('setup.outlineOverviewHint')}>
        <TextArea rows={4} value={overview} onChange={(event) => setOverview(event.target.value)} />
        <div className="mt-2.5 flex justify-end">
          <Button onClick={saveOverview} disabled={savingOverview}>
            {savingOverview ? <Spinner /> : null}
            {t('common.save')}
          </Button>
        </div>
      </Panel>

      <Panel
        title={t('outline.title')}
        description={`${tree.length} 个顶层节点`}
        actions={
          <Button size="sm" onClick={() => void load()}>
            <i className="fa-solid fa-rotate" aria-hidden />
            {t('common.refresh')}
          </Button>
        }
      >
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <Spinner /> {t('common.loading')}
          </div>
        ) : tree.length === 0 ? (
          <EmptyState
            title={t('common.empty')}
            hint={t('outline.emptyHint')}
            action={
              <Button variant="primary" icon="fa-solid fa-plus" onClick={() => openCreate(null)}>
                {t('outline.addRoot')}
              </Button>
            }
          />
        ) : (
          renderNodes(tree)
        )}
      </Panel>

      <Modal
        open={aiNode !== null}
        title={`${t('outline.nodeAi')}：${aiNode?.title ?? ''}`}
        description={t('outline.nodeAiHint')}
        size="lg"
        onClose={() => setAiNode(null)}
        footer={
          <>
            <Button onClick={() => setAiNode(null)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              onClick={applyNodeResult}
              disabled={!generation.text.trim()}
            >
              <i className="fa-solid fa-check" aria-hidden />
              {t('common.apply')}
            </Button>
          </>
        }
      >
        <div className="grid gap-3.5">
          <Field label={t('outline.nodeAiAsk')}>
            <TextArea
              rows={3}
              value={aiAsk}
              onChange={(event) => setAiAsk(event.target.value)}
              placeholder={t('outline.nodeAiAskPlaceholder')}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={() => void runNodeAi()}
              disabled={generation.status === 'running'}
            >
              {generation.status === 'running' ? (
                <Spinner />
              ) : (
                <i className="fa-solid fa-wand-magic-sparkles" aria-hidden />
              )}
              {t('common.generate')}
            </Button>
            {generation.status === 'running' ? (
              <Button onClick={generation.pause}>
                <i className="fa-solid fa-pause" aria-hidden />
                {t('workbench.chapterPause')}
              </Button>
            ) : null}
          </div>
          <BudgetConfirmPrompt generation={generation} />
          {generation.error ? (
            <p className="rounded-[6px] bg-danger-soft px-3 py-2 text-xs leading-relaxed text-danger">
              {generation.error}
            </p>
          ) : null}
          {generation.text ? (
            <div className="card max-h-80 overflow-y-auto px-4 py-3">
              <p className="whitespace-pre-wrap text-xs leading-relaxed">{generation.text}</p>
            </div>
          ) : (
            <p className="text-xs text-ink-faint">{t('workbench.streamIdle')}</p>
          )}
        </div>
      </Modal>

      <Modal
        open={editing !== null || parentForNew !== undefined}
        title={editing ? t('common.edit') : t('outline.addChild')}
        onClose={() => {
          setEditing(null);
          setParentForNew(undefined);
        }}
        footer={
          <>
            <Button
              onClick={() => {
                setEditing(null);
                setParentForNew(undefined);
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={submit}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="grid gap-3.5">
          <Field label={t('outline.nodeTitle')} required>
            <TextInput
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
          </Field>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label={t('outline.nodeKind')}>
              <Select
                value={form.kind}
                onChange={(event) => setForm({ ...form, kind: event.target.value as OutlineKind })}
              >
                {KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(`outline.kind${kind === 'arc' ? 'Arc' : kind === 'beat' ? 'Beat' : 'Sub'}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('outline.nodeStatus')}>
              <Select
                value={form.status}
                onChange={(event) => setForm({ ...form, status: event.target.value as OutlineStatus })}
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(
                      `outline.status${status === 'planned' ? 'Planned' : status === 'active' ? 'Active' : 'Done'}`,
                    )}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={t('outline.nodeContent')}>
            <TextArea
              rows={5}
              value={form.content}
              onChange={(event) => setForm({ ...form, content: event.target.value })}
            />
          </Field>
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
