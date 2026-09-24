'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  Toggle,
} from '@/components/ui/primitives';
import { KIND_COLOR, RelationGraph } from './RelationGraph';
import type { Character, CharacterRelation, RelationKind } from '@/lib/types';

/** 角色关系网。左侧网状图，右侧关系列表与编辑入口。 */

interface RelationsPayload {
  relations: CharacterRelation[];
  characters: Character[];
}

const KINDS: RelationKind[] = [
  'family',
  'lover',
  'friend',
  'rival',
  'enemy',
  'mentor',
  'subordinate',
  'ally',
  'other',
];

const EMPTY_FORM = {
  fromCharacterId: '',
  toCharacterId: '',
  kind: 'friend' as RelationKind,
  label: '',
  bidirectional: true,
  strength: 3,
  notes: '',
};

export function RelationsClient({ novelId }: { novelId: string }) {
  const { t } = useSettings();
  const toast = useToast();
  const router = useRouter();

  const [relations, setRelations] = useState<CharacterRelation[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'graph' | 'list'>('graph');
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CharacterRelation | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CharacterRelation | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<RelationsPayload>(novelResourcePath(novelId, 'relations'));
      setRelations(result.relations);
      setCharacters(result.characters);
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

  const nameOf = useMemo(() => {
    const map = new Map(characters.map((character) => [character.id, character]));
    return (id: string) => map.get(id);
  }, [characters]);

  const isolated = useMemo(() => {
    const connected = new Set<string>();
    for (const relation of relations) {
      connected.add(relation.fromCharacterId);
      connected.add(relation.toCharacterId);
    }
    return characters.filter((character) => !connected.has(character.id));
  }, [characters, relations]);

  /** 弹窗表单的草稿，页面切换后回来接着改。 */
  const formDraft = useFormDraft({
    scope: `${novelId}:relations`,
    targetId: editing?.id ?? null,
    open: creating || editing !== null,
    value: form,
  });

  const openCreate = (fromId?: string) => {
    const cached = formDraft.restore('new');
    if (cached) {
      setForm(cached);
      setCreating(true);
      return;
    }
    setForm({
      ...EMPTY_FORM,
      fromCharacterId: fromId ?? characters[0]?.id ?? '',
      toCharacterId: characters.find((character) => character.id !== (fromId ?? characters[0]?.id))?.id ?? '',
    });
    setCreating(true);
  };

  const openEdit = (relation: CharacterRelation) => {
    const cached = formDraft.restore(relation.id);
    if (cached) setForm(cached);
    else
      setForm({
        fromCharacterId: relation.fromCharacterId,
        toCharacterId: relation.toCharacterId,
        kind: relation.kind,
        label: relation.label,
        bidirectional: relation.bidirectional,
        strength: relation.strength,
        notes: relation.notes,
      });
    setEditing(relation);
  };

  const submit = async () => {
    if (!form.fromCharacterId || !form.toCharacterId) {
      toast.error(t('common.required'));
      return;
    }
    if (form.fromCharacterId === form.toCharacterId) {
      toast.error('角色不能与自己建立关系');
      return;
    }
    try {
      if (editing) {
        await api.patch(novelResourcePath(novelId, 'relations', editing.id), form);
        setEditing(null);
      } else {
        await api.post(novelResourcePath(novelId, 'relations'), form);
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
      await api.delete(novelResourcePath(novelId, 'relations', pendingDelete.id));
      setPendingDelete(null);
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

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-soft">{t('relations.title')}</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-muted">
            {t('relations.hint')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-[6px] border border-line">
            {(['graph', 'list'] as const).map((item) => (
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
                {item === 'graph' ? t('relations.graphView') : t('relations.listView')}
              </button>
            ))}
          </div>
          <Button
            variant="primary"
            icon="fa-solid fa-plus"
            onClick={() => openCreate()}
            disabled={characters.length < 2}
          >
            {t('relations.newRelation')}
          </Button>
        </div>
      </header>

      {characters.length < 2 ? (
        <Panel>
          <EmptyState
            title={t('common.empty')}
            hint={t('relations.emptyHint')}
            action={
              <Link href={`/novels/${novelId}/characters`} className="btn btn-primary">
                <i className="fa-solid fa-users" aria-hidden />
                {t('nav.characters')}
              </Link>
            }
          />
        </Panel>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
          {view === 'graph' ? (
            <Panel title={t('relations.graphView')} description={t('relations.graphHint')}>
              <RelationGraph
                characters={characters}
                relations={relations}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onOpenDossier={(characterId) => {
                  router.push(`/novels/${novelId}/characters`);
                  setSelectedId(characterId);
                }}
              />
            </Panel>
          ) : (
            <Panel title={t('relations.listView')}>
              {relations.length === 0 ? (
                <p className="text-sm text-ink-faint">{t('common.empty')}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {relations.map((relation) => {
                    const from = nameOf(relation.fromCharacterId);
                    const to = nameOf(relation.toCharacterId);
                    return (
                      <li
                        key={relation.id}
                        className="flex flex-wrap items-center gap-3 py-2.5"
                        onMouseEnter={() => setSelectedId(relation.fromCharacterId)}
                      >
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: KIND_COLOR[relation.kind] }}
                        />
                        <span className="text-sm text-soft">
                          {from?.name ?? t('common.unknown')}
                          <i className="fa-solid fa-arrow-right-long mx-2 text-[0.7rem] text-ink-faint" aria-hidden />
                          {to?.name ?? t('common.unknown')}
                        </span>
                        <span className="chip">{relation.kind}</span>
                        {relation.label ? <span className="chip chip-accent">{relation.label}</span> : null}
                        <span className="chip">
                          {t('relations.strength')} {relation.strength}/5
                        </span>
                        <div className="ml-auto flex items-center gap-1">
                          <Button size="sm" onClick={() => openEdit(relation)}>
                            <i className="fa-solid fa-pen" aria-hidden />
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => setPendingDelete(relation)}>
                            <i className="fa-solid fa-trash-can" aria-hidden />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          )}

          <aside className="flex flex-col gap-4">
            <Panel title={t('relations.selectCharacter')}>
              {selectedId ? (
                (() => {
                  const character = nameOf(selectedId);
                  if (!character) return <p className="text-xs text-ink-faint">{t('common.unknown')}</p>;
                  const related = relations.filter(
                    (relation) =>
                      relation.fromCharacterId === selectedId || relation.toCharacterId === selectedId,
                  );
                  return (
                    <div className="flex flex-col gap-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-sunken text-lg">
                          {character.emoji}
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-soft">{character.name}</p>
                          <p className="text-xs text-ink-muted">
                            {t(`characters.role.${character.roleType}`)}
                          </p>
                        </div>
                      </div>
                      <ul className="flex flex-col gap-1 text-xs text-ink-muted">
                        {related.map((relation) => {
                          const otherId =
                            relation.fromCharacterId === selectedId
                              ? relation.toCharacterId
                              : relation.fromCharacterId;
                          return (
                            <li key={relation.id}>
                              · {nameOf(otherId)?.name ?? t('common.unknown')}
                              <span className="text-ink-faint">
                                {' '}
                                {relation.kind}
                                {relation.label ? ` · ${relation.label}` : ''}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                      <div className="flex gap-2">
                        <Link href={`/novels/${novelId}/characters`} className="btn">
                          {t('relations.goToDossier')}
                        </Link>
                        <Button onClick={() => openCreate(selectedId)}>{t('relations.newRelation')}</Button>
                      </div>
                    </div>
                  );
                })()
              ) : (
                <p className="text-xs text-ink-faint">{t('relations.graphHint')}</p>
              )}
            </Panel>

            {isolated.length > 0 ? (
              <Panel title={t('relations.isolatedNodes')}>
                <div className="flex flex-wrap gap-1.5">
                  {isolated.map((character) => (
                    <button
                      key={character.id}
                      type="button"
                      className="chip transition-colors duration-200 hover:border-accent-border hover:text-accent-strong"
                      onClick={() => {
                        setSelectedId(character.id);
                        openCreate(character.id);
                      }}
                    >
                      {character.emoji} {character.name}
                    </button>
                  ))}
                </div>
              </Panel>
            ) : null}

            <Panel title={t('relations.kind')}>
              <ul className="flex flex-col gap-1.5 text-xs">
                {KINDS.map((kind) => (
                  <li key={kind} className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: KIND_COLOR[kind] }}
                    />
                    <span className="text-ink-muted">
                      {t(`relations.kindLabels.${kind}`)}
                    </span>
                    <span className="ml-auto text-ink-faint">
                      {relations.filter((relation) => relation.kind === kind).length}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          </aside>
        </div>
      )}

      <Modal
        open={creating || editing !== null}
        title={editing ? t('common.edit') : t('relations.newRelation')}
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
            <Field label={t('relations.from')} required>
              <Select
                value={form.fromCharacterId}
                onChange={(event) => setForm({ ...form, fromCharacterId: event.target.value })}
              >
                {characters.map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('relations.to')} required>
              <Select
                value={form.toCharacterId}
                onChange={(event) => setForm({ ...form, toCharacterId: event.target.value })}
              >
                {characters.map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label={t('relations.kind')}>
            <Select
              value={form.kind}
              onChange={(event) => setForm({ ...form, kind: event.target.value as RelationKind })}
            >
              {KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`relations.kindLabels.${kind}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('relations.label')}>
            <TextInput
              value={form.label}
              onChange={(event) => setForm({ ...form, label: event.target.value })}
            />
          </Field>
          <Field label={`${t('relations.strength')} ${form.strength}/5`}>
            <input
              type="range"
              min={1}
              max={5}
              value={form.strength}
              onChange={(event) => setForm({ ...form, strength: Number(event.target.value) })}
              className="w-full cursor-pointer accent-[var(--accent)]"
            />
          </Field>
          <Toggle
            checked={form.bidirectional}
            onChange={(value) => setForm({ ...form, bidirectional: value })}
            label={t('relations.bidirectional')}
          />
          <Field label={t('relations.notes')}>
            <TextArea
              rows={3}
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('common.delete')}
        message={t('relations.deleteConfirm')}
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={remove}
      />
    </div>
  );
}
