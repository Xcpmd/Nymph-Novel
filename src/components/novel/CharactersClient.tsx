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
  Select,
  Spinner,
  TextArea,
  TextInput,
  Toggle,
} from '@/components/ui/primitives';
import type { Character, CharacterRole, ForeshadowingItem, SpeechColorMode } from '@/lib/types';

/** 角色图鉴。记录称呼、性格、能力体系与伏笔管理。 */

const ROLES: CharacterRole[] = ['protagonist', 'supporting', 'antagonist', 'minor', 'extra'];
const ROLE_LABEL: Record<CharacterRole, string> = {
  protagonist: 'protagonist',
  supporting: 'supporting',
  antagonist: 'antagonist',
  minor: 'minor',
  extra: 'extra',
};

const EMPTY_FORM = {
  name: '',
  aliases: '',
  emoji: '🙂',
  roleType: 'supporting' as CharacterRole,
  gender: '',
  age: '',
  faction: '',
  personality: '',
  appearance: '',
  ability: '',
  background: '',
  arc: '',
  tags: '',
  notes: '',
  speechHue: 0,
  speechColorMode: 'auto' as SpeechColorMode,
  isPrimary: false,
};

export function CharactersClient({ novelId }: { novelId: string }) {
  const { t } = useSettings();
  const toast = useToast();

  const [characters, setCharacters] = useState<Character[]>([]);
  const [filter, setFilter] = useState<'all' | CharacterRole>('all');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Character | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Character | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [foreshadowing, setForeshadowing] = useState<ForeshadowingItem[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get<Character[]>(novelResourcePath(novelId, 'characters'));
      setCharacters(result);
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

  const openCreate = () => {
    setForm({ ...EMPTY_FORM });
    setForeshadowing([]);
    setCreating(true);
  };

  const openEdit = (character: Character) => {
    setForm({
      name: character.name,
      aliases: character.aliases.join('，'),
      emoji: character.emoji,
      roleType: character.roleType,
      gender: character.gender,
      age: character.age,
      faction: character.faction,
      personality: character.personality,
      appearance: character.appearance,
      ability: character.ability,
      background: character.background,
      arc: character.arc,
      tags: character.tags.join('，'),
      notes: character.notes,
      speechHue: character.speechHue,
      speechColorMode: character.speechColorMode,
      isPrimary: character.isPrimary,
    });
    setForeshadowing(character.foreshadowing);
    setEditing(character);
  };

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error(t('common.required'));
      return;
    }
    const payload = {
      ...form,
      aliases: form.aliases.split(/[，,、\s]+/).filter(Boolean),
      tags: form.tags.split(/[，,、\s]+/).filter(Boolean),
      foreshadowing,
    };
    try {
      if (editing) {
        await api.patch(novelResourcePath(novelId, 'characters', editing.id), payload);
        setEditing(null);
      } else {
        await api.post(novelResourcePath(novelId, 'characters'), payload);
        setCreating(false);
      }
      toast.success(t('common.saved'));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    try {
      await api.delete(novelResourcePath(novelId, 'characters', pendingDelete.id));
      setPendingDelete(null);
      await load();
      toast.success(t('common.saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  const visible = filter === 'all' ? characters : characters.filter((item) => item.roleType === filter);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-soft">{t('characters.title')}</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-muted">
            {t('characters.hint')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={filter}
            onChange={(event) => setFilter(event.target.value as 'all' | CharacterRole)}
            className="w-auto"
          >
            <option value="all">{t('characters.filterAll')}</option>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {t(`characters.role.${ROLE_LABEL[role]}`)}
              </option>
            ))}
          </Select>
          <Link2
            href={`/novels/${novelId}/relations`}
            label={t('nav.relations')}
            icon="fa-solid fa-share-nodes"
          />
          <Button variant="primary" icon="fa-solid fa-plus" onClick={openCreate}>
            {t('characters.newCharacter')}
          </Button>
        </div>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <Spinner /> {t('common.loading')}
        </div>
      ) : visible.length === 0 ? (
        <Panel>
          <EmptyState
            title={t('common.empty')}
            hint={t('characters.emptyHint')}
            action={
              <Button variant="primary" icon="fa-solid fa-plus" onClick={openCreate}>
                {t('characters.newCharacter')}
              </Button>
            }
          />
        </Panel>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((character) => (
            <li key={character.id} className="card card-hover animate-rise flex flex-col gap-2.5 p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-lg">
                  {character.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-soft">{character.name}</span>
                    {character.isPrimary ? (
                      <span className="chip chip-accent">{t('characters.isPrimary')}</span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {t(`characters.role.${ROLE_LABEL[character.roleType]}`)}
                    {character.faction ? ` · ${character.faction}` : ''}
                    {character.aliases.length > 0 ? ` · ${character.aliases.join('、')}` : ''}
                  </p>
                </div>
              </div>

              {character.personality ? (
                <p className="line-clamp-2 text-xs leading-relaxed text-ink-muted">
                  {character.personality}
                </p>
              ) : null}

              {character.foreshadowing.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {character.foreshadowing.slice(0, 3).map((item) => (
                    <span
                      key={item.id}
                      className={clsx(
                        'chip',
                        item.status === 'resolved' && 'text-ok',
                        item.status === 'pending' && 'text-warn',
                      )}
                    >
                      <i className="fa-solid fa-bookmark text-[0.6rem]" aria-hidden />
                      {item.title}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="mt-auto flex items-center gap-2 pt-1">
                <Button size="sm" onClick={() => openEdit(character)}>
                  <i className="fa-solid fa-pen" aria-hidden />
                  {t('common.edit')}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  className="ml-auto"
                  onClick={() => setPendingDelete(character)}
                >
                  <i className="fa-solid fa-trash-can" aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={creating || editing !== null}
        title={editing ? `${t('common.edit')} · ${editing.name}` : t('characters.newCharacter')}
        description={t('characters.hint')}
        size="xl"
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
        <div className="grid gap-3.5 lg:grid-cols-2">
          <div className="grid gap-3.5">
            <div className="grid grid-cols-[4rem_1fr] gap-3">
              <Field label={t('characters.emoji')}>
                <TextInput
                  value={form.emoji}
                  className="text-center"
                  onChange={(event) => setForm({ ...form, emoji: event.target.value })}
                />
              </Field>
              <Field label={t('characters.name')} required>
                <TextInput
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </Field>
            </div>
            <Field label={t('characters.aliases')} hint={t('characters.aliasesHint')}>
              <TextInput
                value={form.aliases}
                onChange={(event) => setForm({ ...form, aliases: event.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3.5">
              <Field label={t('characters.roleType')}>
                <Select
                  value={form.roleType}
                  onChange={(event) =>
                    setForm({ ...form, roleType: event.target.value as CharacterRole })
                  }
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {t(`characters.role.${ROLE_LABEL[role]}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('characters.faction')}>
                <TextInput
                  value={form.faction}
                  onChange={(event) => setForm({ ...form, faction: event.target.value })}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3.5">
              <Field label={t('characters.gender')}>
                <TextInput
                  value={form.gender}
                  onChange={(event) => setForm({ ...form, gender: event.target.value })}
                />
              </Field>
              <Field label={t('characters.age')}>
                <TextInput
                  value={form.age}
                  onChange={(event) => setForm({ ...form, age: event.target.value })}
                />
              </Field>
            </div>
            <Toggle
              checked={form.isPrimary}
              onChange={(value) => setForm({ ...form, isPrimary: value })}
              label={t('characters.isPrimary')}
              hint={t('characters.isPrimaryHint')}
            />
            <Field label={t('characters.tags')}>
              <TextInput
                value={form.tags}
                onChange={(event) => setForm({ ...form, tags: event.target.value })}
              />
            </Field>
          </div>

          <div className="grid gap-3.5">
            <Field label={t('characters.appearance')}>
              <TextArea
                rows={2}
                value={form.appearance}
                onChange={(event) => setForm({ ...form, appearance: event.target.value })}
              />
            </Field>
            <Field label={t('characters.personality')}>
              <TextArea
                rows={3}
                value={form.personality}
                onChange={(event) => setForm({ ...form, personality: event.target.value })}
              />
            </Field>
            <Field label={t('characters.ability')}>
              <TextArea
                rows={3}
                value={form.ability}
                onChange={(event) => setForm({ ...form, ability: event.target.value })}
              />
            </Field>
            <Field label={t('characters.background')}>
              <TextArea
                rows={3}
                value={form.background}
                onChange={(event) => setForm({ ...form, background: event.target.value })}
              />
            </Field>
            <Field label={t('characters.arc')}>
              <TextArea
                rows={2}
                value={form.arc}
                onChange={(event) => setForm({ ...form, arc: event.target.value })}
              />
            </Field>
            <Field label={t('characters.notes')}>
              <TextArea
                rows={2}
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
              />
            </Field>
          </div>

          {/* 发言配色：AI 添加角色时会自动分配色相，此处可手动微调 */}
          <div className="lg:col-span-2">
            <Panel title={t('characters.speechColor')} description={t('characters.speechColorHint')} compact>
              <div className="grid gap-3.5 sm:grid-cols-[minmax(0,1fr)_12rem]">
                <Field label={t('characters.speechHue')}>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={0}
                      max={359}
                      value={form.speechHue}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          speechHue: Number(event.target.value),
                          speechColorMode: 'manual',
                        })
                      }
                      className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full"
                      style={{
                        background:
                          'linear-gradient(to right, hsl(0 62% 52%), hsl(60 62% 52%), hsl(120 62% 52%), hsl(180 62% 52%), hsl(240 62% 52%), hsl(300 62% 52%), hsl(359 62% 52%))',
                      }}
                    />
                    <span className="w-12 shrink-0 text-right text-xs font-mono text-ink-muted">
                      {form.speechHue}
                    </span>
                  </div>
                </Field>
                <Field label={t('characters.speechColorMode')}>
                  <Select
                    value={form.speechColorMode}
                    onChange={(event) =>
                      setForm({ ...form, speechColorMode: event.target.value as SpeechColorMode })
                    }
                  >
                    <option value="auto">{t('characters.speechColorAuto')}</option>
                    <option value="manual">{t('characters.speechColorManual')}</option>
                  </Select>
                </Field>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                <span className="text-[0.68rem] text-ink-faint">{t('common.preview')}</span>
                <span
                  className="talk-line text-sm"
                  style={{ ['--talk-hue' as string]: form.speechHue }}
                >
                  “{t('characters.speechSample')}”
                </span>
              </div>
            </Panel>
          </div>

          <div className="lg:col-span-2">
            <Panel title={t('characters.foreshadowing')} description={t('characters.foreshadowingHint')} compact>
              <ul className="flex flex-col gap-2">
                {foreshadowing.map((item, index) => (
                  <li key={item.id} className="card grid gap-2 p-2.5 sm:grid-cols-[1fr_1fr_9rem_auto]">
                    <TextInput
                      value={item.title}
                      placeholder={t('characters.foreshadowingTitle')}
                      onChange={(event) =>
                        setForeshadowing((current) =>
                          current.map((entry, position) =>
                            position === index ? { ...entry, title: event.target.value } : entry,
                          ),
                        )
                      }
                    />
                    <TextInput
                      value={item.detail}
                      placeholder={t('characters.foreshadowingDetail')}
                      onChange={(event) =>
                        setForeshadowing((current) =>
                          current.map((entry, position) =>
                            position === index ? { ...entry, detail: event.target.value } : entry,
                          ),
                        )
                      }
                    />
                    <Select
                      value={item.status}
                      onChange={(event) =>
                        setForeshadowing((current) =>
                          current.map((entry, position) =>
                            position === index
                              ? { ...entry, status: event.target.value as ForeshadowingItem['status'] }
                              : entry,
                          ),
                        )
                      }
                    >
                      <option value="planted">{t('characters.foreshadowingPlanted')}</option>
                      <option value="pending">{t('characters.foreshadowingPending')}</option>
                      <option value="resolved">{t('characters.foreshadowingResolved')}</option>
                    </Select>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() =>
                        setForeshadowing((current) => current.filter((_, position) => position !== index))
                      }
                    >
                      <i className="fa-solid fa-trash-can" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
              <Button
                size="sm"
                className="mt-2"
                onClick={() =>
                  setForeshadowing((current) => [
                    ...current,
                    {
                      id: `fs_${Date.now()}_${current.length}`,
                      title: '',
                      detail: '',
                      status: 'planted',
                    },
                  ])
                }
              >
                <i className="fa-solid fa-plus" aria-hidden />
                {t('characters.addForeshadowing')}
              </Button>
            </Panel>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('common.delete')}
        message={t('characters.deleteConfirm')}
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={remove}
      />
    </div>
  );
}

/** 页面内的导航按钮，复用统一的按钮样式。 */
function Link2({ href, label, icon }: { href: string; label: string; icon: string }) {
  return (
    <Link href={href} className="btn">
      <i className={icon} aria-hidden />
      {label}
    </Link>
  );
}
