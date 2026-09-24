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
import type { EncyclopediaEntry, EncyclopediaVersion } from '@/lib/types';

/** 百科全书。按分类生成目录，支持检索与编辑，同一条目可保存多个版本。 */

interface EncyclopediaPayload {
  entries: EncyclopediaEntry[];
  categories: string[];
}

const CATEGORY_PRESETS = ['地理', '种族', '动植物', '组织', '物品', '功法', '事件', '制度', '其他'];

const EMPTY_FORM = {
  name: '',
  category: '地理',
  aliases: '',
  summary: '',
  content: '',
  tags: '',
};

export function EncyclopediaClient({ novelId }: { novelId: string }) {
  const { t } = useSettings();
  const toast = useToast();

  const [entries, setEntries] = useState<EncyclopediaEntry[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<EncyclopediaEntry | null>(null);
  const [pendingDelete, setPendingDelete] = useState<EncyclopediaEntry | null>(null);
  /** 当前编辑条目的版本历史，新的在前 */
  const [versions, setVersions] = useState<EncyclopediaVersion[]>([]);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<EncyclopediaPayload>(novelResourcePath(novelId, 'encyclopedia'));
      setEntries(result.entries);
      setCategories(result.categories);
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

  const catalog = useMemo(() => {
    const map = new Map<string, EncyclopediaEntry[]>();
    for (const entry of entries) {
      const list = map.get(entry.category) ?? [];
      list.push(entry);
      map.set(entry.category, list);
    }
    return Array.from(map.entries())
      .map(([category, list]) => ({ category, list }))
      .sort((a, b) => b.list.length - a.list.length);
  }, [entries]);

  const visible = useMemo(() => {
    const term = keyword.trim().toLowerCase();
    return entries.filter((entry) => {
      if (activeCategory && entry.category !== activeCategory) return false;
      if (!term) return true;
      return (
        entry.name.toLowerCase().includes(term) ||
        entry.aliases.toLowerCase().includes(term) ||
        entry.summary.toLowerCase().includes(term) ||
        entry.content.toLowerCase().includes(term)
      );
    });
  }, [entries, activeCategory, keyword]);

  /** 弹窗表单的草稿，页面切换后回来接着改。 */
  const formDraft = useFormDraft({
    scope: `${novelId}:encyclopedia`,
    targetId: editing?.id ?? null,
    open: creating || editing !== null,
    value: form,
  });

  const openCreate = (category?: string) => {
    const cached = formDraft.restore('new');
    if (cached) setForm(cached);
    else setForm({ ...EMPTY_FORM, category: category ?? CATEGORY_PRESETS[0]! });
    setCreating(true);
  };

  const openEdit = (entry: EncyclopediaEntry) => {
    const cached = formDraft.restore(entry.id);
    if (cached) setForm(cached);
    else
      setForm({
        name: entry.name,
        category: entry.category,
        aliases: entry.aliases,
        summary: entry.summary,
        content: entry.content,
        tags: entry.tags.join('，'),
      });
    setEditing(entry);
    void loadVersions(entry.id);
  };

  /** 载入条目的版本历史，供切换启用版本。 */
  const loadVersions = async (entryId: string) => {
    try {
      const result = await api.get<{ versions: EncyclopediaVersion[] }>(
        `${novelResourcePath(novelId, 'encyclopedia-versions')}?entryId=${entryId}`,
      );
      setVersions(result.versions ?? []);
    } catch {
      setVersions([]);
    }
  };

  /** 把某个版本设为启用。其余版本由服务端一并停用。 */
  const activateVersion = async (versionId: string) => {
    try {
      await api.patch(novelResourcePath(novelId, 'encyclopedia-versions', versionId), {
        action: 'activate',
      });
      toast.success(t('common.saved'));
      if (editing) await loadVersions(editing.id);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error(t('common.required'));
      return;
    }
    const payload = {
      ...form,
      tags: form.tags.split(/[，,、\s]+/).filter(Boolean),
    };
    try {
      if (editing) {
        await api.patch(novelResourcePath(novelId, 'encyclopedia', editing.id), payload);
        setEditing(null);
      } else {
        await api.post(novelResourcePath(novelId, 'encyclopedia'), payload);
        setCreating(false);
      }
      toast.success(t('common.saved'));
      formDraft.clear();
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    try {
      await api.delete(novelResourcePath(novelId, 'encyclopedia', pendingDelete.id));
      setPendingDelete(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-soft">{t('encyclopedia.title')}</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-muted">
            {t('encyclopedia.hint')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TextInput
            value={keyword}
            placeholder={t('common.search')}
            className="w-48"
            onChange={(event) => setKeyword(event.target.value)}
          />
          <Button variant="primary" icon="fa-solid fa-plus" onClick={() => openCreate()}>
            {t('encyclopedia.newEntry')}
          </Button>
        </div>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Spinner /> {t('common.loading')}
        </div>
      ) : entries.length === 0 ? (
        <Panel>
          <EmptyState
            icon="fa-solid fa-book-atlas"
            title={t('common.empty')}
            hint={t('encyclopedia.emptyHint')}
            action={
              <Button variant="primary" icon="fa-solid fa-plus" onClick={() => openCreate()}>
                {t('encyclopedia.newEntry')}
              </Button>
            }
          />
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <Panel title={t('encyclopedia.catalog')} compact>
            <ul className="flex flex-col gap-0.5">
              <li>
                <button
                  type="button"
                  onClick={() => setActiveCategory('')}
                  className={clsx(
                    'nav-item w-full justify-between',
                    activeCategory === '' && 'nav-item-active',
                  )}
                >
                  <span>{t('common.all')}</span>
                  <span className="text-xs text-ink-faint">{entries.length}</span>
                </button>
              </li>
              {catalog.map((group) => (
                <li key={group.category}>
                  <button
                    type="button"
                    onClick={() => setActiveCategory(group.category)}
                    className={clsx(
                      'nav-item w-full justify-between',
                      activeCategory === group.category && 'nav-item-active',
                    )}
                  >
                    <span className="truncate">{group.category}</span>
                    <span className="text-xs text-ink-faint">{group.list.length}</span>
                  </button>
                </li>
              ))}
            </ul>
            {categories.length === 0 ? null : (
              <p className="mt-3 text-[0.68rem] leading-relaxed text-ink-faint">
                {t('encyclopedia.catalogCount', { count: entries.length })}
              </p>
            )}
          </Panel>

          <div className="flex flex-col gap-3">
            {visible.length === 0 ? (
              <Panel>
                <p className="text-sm text-ink-faint">{t('search.noResult')}</p>
              </Panel>
            ) : (
              visible.map((entry) => (
                <article key={entry.id} className="card card-hover animate-rise p-4">
                  <header className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-soft">{entry.name}</h3>
                        <span className="chip chip-accent">{entry.category}</span>
                        {entry.aliases ? (
                          <span className="chip">{entry.aliases}</span>
                        ) : null}
                        {entry.versionCount > 1 ? (
                          <span
                            className="chip"
                            title={t('encyclopedia.versionHint')}
                          >
                            <i className="fa-solid fa-code-branch text-[0.62rem]" aria-hidden />
                            {entry.activeVersionNo}/{entry.versionCount}
                          </span>
                        ) : null}
                      </div>
                      {entry.summary ? (
                        <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
                          {entry.summary}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button size="sm" onClick={() => openEdit(entry)}>
                        <i className="fa-solid fa-pen" aria-hidden />
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => setPendingDelete(entry)}>
                        <i className="fa-solid fa-trash-can" aria-hidden />
                      </Button>
                    </div>
                  </header>
                  {entry.content ? (
                    <p className="mt-2.5 text-xs leading-relaxed whitespace-pre-wrap text-ink-muted">
                      {entry.content}
                    </p>
                  ) : null}
                  {entry.tags.length > 0 ? (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {entry.tags.map((tag) => (
                        <span key={tag} className="chip">
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </div>
      )}

      <Modal
        open={creating || editing !== null}
        title={editing ? t('common.edit') : t('encyclopedia.newEntry')}
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
            <Button variant="primary" onClick={submit}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="grid gap-3.5">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label={t('encyclopedia.name')} required>
              <TextInput
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </Field>
            <Field label={t('encyclopedia.category')} hint={t('encyclopedia.categoryPlaceholder')}>
              <Select
                value={form.category}
                onChange={(event) => setForm({ ...form, category: event.target.value })}
              >
                {CATEGORY_PRESETS.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
                {categories
                  .filter((category) => !CATEGORY_PRESETS.includes(category))
                  .map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>
          <Field label={t('encyclopedia.aliases')}>
            <TextInput
              value={form.aliases}
              onChange={(event) => setForm({ ...form, aliases: event.target.value })}
            />
          </Field>
          <Field label={t('encyclopedia.summary')}>
            <TextInput
              value={form.summary}
              onChange={(event) => setForm({ ...form, summary: event.target.value })}
            />
          </Field>
          <Field label={t('encyclopedia.content')}>
            <TextArea
              rows={8}
              value={form.content}
              onChange={(event) => setForm({ ...form, content: event.target.value })}
            />
          </Field>
          <Field label={t('encyclopedia.tags')}>
            <TextInput
              value={form.tags}
              onChange={(event) => setForm({ ...form, tags: event.target.value })}
            />
          </Field>

          {/*
            版本历史。同名条目再次登记会在这里留下新版本，
            只有启用的一版会进入给模型的上下文，因此可以放心回退。
          */}
          {editing && versions.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-[10px] border border-[var(--glass-border)] p-3">
              <p className="panel-title">{t('encyclopedia.versions')}</p>
              <ul className="flex flex-col gap-1.5">
                {versions.map((version) => (
                  <li
                    key={version.id}
                    className="flex flex-wrap items-center gap-2 rounded-[6px] px-2 py-1.5"
                    style={
                      version.isActive
                        ? { background: 'var(--accent-soft)' }
                        : undefined
                    }
                  >
                    <span className="text-[0.78rem] font-semibold">
                      v{version.versionNo}
                    </span>
                    <span className="chip">
                      {version.origin === 'ai'
                        ? t('encyclopedia.originAi')
                        : t('encyclopedia.originManual')}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[0.72rem] text-ink-muted">
                      {version.summary || version.content.slice(0, 40)}
                    </span>
                    {version.isActive ? (
                      <span className="chip chip-accent">{t('encyclopedia.versionActive')}</span>
                    ) : (
                      <Button size="sm" onClick={() => void activateVersion(version.id)}>
                        <i className="fa-solid fa-check" aria-hidden />
                        {t('encyclopedia.versionUse')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-[0.72rem] leading-relaxed text-ink-faint">
                {t('encyclopedia.versionHint')}
              </p>
            </div>
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('common.delete')}
        message={t('encyclopedia.deleteConfirm')}
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={remove}
      />
    </div>
  );
}
