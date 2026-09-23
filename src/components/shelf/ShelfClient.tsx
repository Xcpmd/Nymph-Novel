'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { api } from '@/lib/client/api';
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
import { useSettings } from '@/components/providers/SettingsProvider';
import type { CoverFit, Novel } from '@/lib/types';

/** 书架页。新建、导入、删除小说，并展示每部作品的创作进度与自定义封面。 */

const EMOJI_CHOICES = ['📖', '🐉', '⚔️', '🌊', '🌌', '🕯️', '🧭', '🍶', '🌸', '🔥', '🪶', '🗺️'];

/**
 * 把时间戳格式化为 年-月-日。
 *
 * 封面悬浮层空间有限，用固定宽度的数字格式比相对时间更易扫读。
 */
function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (input: number) => String(input).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

type SortKey = 'updated' | 'title' | 'words';

/**
 * 封面。有自定义图片时显示图片，否则降级为 emoji。
 * coverFit 决定图片是裁切填充还是完整显示。
 */
function NovelCover({
  novel,
  size = 'md',
}: {
  novel: Pick<Novel, 'coverEmoji' | 'coverImage' | 'coverFit' | 'title'>;
  size?: 'sm' | 'md' | 'lg';
}) {
  const box =
    size === 'sm'
      ? 'h-6 w-6 rounded-[4px]'
      : size === 'lg'
        ? 'h-28 w-20 rounded-[10px]'
        : 'h-11 w-11 rounded-[12px]';
  const text = size === 'md' ? 'text-xl' : size === 'lg' ? 'text-4xl' : 'text-[0.72rem]';

  if (novel.coverImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={novel.coverImage}
        alt={novel.title}
        className={clsx(
          'shrink-0 overflow-hidden bg-surface-sunken object-cover',
          box,
          novel.coverFit === 'contain' && 'object-contain',
        )}
      />
    );
  }

  return (
    <span
      className={clsx(
        'flex shrink-0 items-center justify-center bg-surface-sunken',
        box,
        text,
      )}
    >
      {novel.coverEmoji}
    </span>
  );
}

export function ShelfClient({ initialNovels }: { initialNovels: Novel[] }) {
  const { t } = useSettings();
  const toast = useToast();
  const router = useRouter();

  const [novels, setNovels] = useState(initialNovels);
  const [sortKey, setSortKey] = useState<SortKey>('updated');
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Novel | null>(null);
  const [coverEditing, setCoverEditing] = useState<Novel | null>(null);

  const [form, setForm] = useState({
    title: '',
    author: '',
    genre: '',
    summary: '',
    coverEmoji: '📖',
    coverImage: '',
    coverFit: 'cover' as CoverFit,
  });

  const [coverForm, setCoverForm] = useState({
    coverEmoji: '📖',
    coverImage: '',
    coverFit: 'cover' as CoverFit,
  });

  const [importForm, setImportForm] = useState({
    title: '',
    author: '',
    genre: '',
    mode: 'text' as 'text' | 'archive',
    text: '',
  });

  const sorted = useMemo(() => {
    const list = [...novels];
    if (sortKey === 'title') {
      list.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'));
    } else if (sortKey === 'words') {
      list.sort((a, b) => b.wordCount - a.wordCount);
    } else {
      list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    return list;
  }, [novels, sortKey]);

  const refresh = async () => {
    const result = await api.get<{ novels: Novel[] }>('/api/novels');
    setNovels(result.novels);
  };

  /** 打开封面编辑弹窗，回填当前的 emoji、图片与填充方式。 */
  const openCoverEdit = (novel: Novel) => {
    setCoverForm({
      coverEmoji: novel.coverEmoji,
      coverImage: novel.coverImage,
      coverFit: novel.coverFit,
    });
    setCoverEditing(novel);
  };

  const saveCover = async () => {
    if (!coverEditing) return;
    try {
      await api.patch(`/api/novels/${coverEditing.id}`, {
        coverEmoji: coverForm.coverEmoji,
        coverImage: coverForm.coverImage.trim(),
        coverFit: coverForm.coverFit,
      });
      toast.success(t('common.saved'));
      setCoverEditing(null);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  };

  /**
   * 读取本地图片文件并转成 data URL。
   * 单用户本地运行，直接内联进数据库即可，无需额外的静态资源目录。
   */
  const pickCoverFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error(t('shelf.coverNotImage'));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error(t('shelf.coverTooLarge'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (result) setCoverForm((current) => ({ ...current, coverImage: result }));
    };
    reader.readAsDataURL(file);
  };

  const handleCreate = async () => {
    if (!form.title.trim()) {
      toast.error(t('common.required'));
      return;
    }
    setBusy(true);
    try {
      const result = await api.post<{ novel: Novel }>('/api/novels', form);
      toast.success(t('common.saved'));
      setCreateOpen(false);
      setForm({
        title: '',
        author: '',
        genre: '',
        summary: '',
        coverEmoji: '📖',
        coverImage: '',
        coverFit: 'cover',
      });
      await refresh();
      router.push(`/novels/${result.novel.id}/setup`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    if (!importForm.text.trim()) {
      toast.error(t('common.contentEmpty').replace('内容', '导入内容'));
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        title: importForm.title,
        author: importForm.author,
        genre: importForm.genre,
      };
      if (importForm.mode === 'archive') {
        payload.archive = JSON.parse(importForm.text);
      } else {
        payload.text = importForm.text;
      }
      const result = await api.post<{ novelId: string; chapters: number; volumes: number }>(
        '/api/novels/import',
        payload,
      );
      toast.success(
        t('shelf.importSuccess', { chapters: result.chapters, volumes: result.volumes }),
      );
      setImportOpen(false);
      setImportForm({ title: '', author: '', genre: '', mode: 'text', text: '' });
      await refresh();
      router.push(`/novels/${result.novelId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await api.delete(`/api/novels/${pendingDelete.id}`);
      toast.success(t('common.saved'));
      setPendingDelete(null);
      await refresh();
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-soft">{t('shelf.title')}</h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-muted">
            {t('shelf.subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={sortKey}
            onChange={(event) => setSortKey(event.target.value as SortKey)}
            className="w-auto"
          >
            <option value="updated">{t('shelf.sortByUpdated')}</option>
            <option value="title">{t('shelf.sortByTitle')}</option>
            <option value="words">{t('shelf.sortByWords')}</option>
          </Select>
          <Button icon="fa-solid fa-file-import" onClick={() => setImportOpen(true)}>
            {t('shelf.importNovel')}
          </Button>
          <Button
            variant="primary"
            icon="fa-solid fa-plus"
            onClick={() => setCreateOpen(true)}
          >
            {t('shelf.newNovel')}
          </Button>
        </div>
      </header>

      {sorted.length === 0 ? (
        <Panel>
          <EmptyState
            title={t('shelf.emptyTitle')}
            hint={t('shelf.emptyHint')}
            action={
              <Button variant="primary" icon="fa-solid fa-plus" onClick={() => setCreateOpen(true)}>
                {t('shelf.newNovel')}
              </Button>
            }
          />
        </Panel>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-x-5 gap-y-6">
          {sorted.map((novel) => (
            <li key={novel.id} className="cover-group animate-rise">
              {/*
                常态只呈现封面。书名、作者、章数与更新日期收进悬浮层，
                鼠标移入后才从底部渐变里浮出。
              */}
              <Link href={`/novels/${novel.id}`} className="cover-card" title={novel.title}>
                {novel.coverImage ? (
                  <>
                    {/* 完整显示时先垫一层模糊放大的原图，补满留白 */}
                    {novel.coverFit === 'contain' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={novel.coverImage}
                        alt=""
                        aria-hidden
                        className="cover-card-blur"
                      />
                    ) : null}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={novel.coverImage}
                      alt={novel.title}
                      className="cover-card-media"
                      style={{ objectFit: novel.coverFit === 'contain' ? 'contain' : 'cover' }}
                    />
                  </>
                ) : (
                  <span className="cover-card-fallback" aria-hidden>
                    {novel.coverEmoji}
                  </span>
                )}

                <span className="cover-card-veil" aria-hidden />

                <div className="cover-card-info">
                  <p className="truncate text-sm font-semibold">{novel.title}</p>
                  <p className="mt-0.5 truncate text-[0.7rem] text-white/75">
                    {novel.author || t('shelf.author')} · {novel.chapterCount}
                    {t('shelf.chaptersCount')}
                  </p>
                  <p className="mt-0.5 text-[0.62rem] text-white/55">
                    {formatDate(novel.updatedAt)}
                  </p>
                </div>
              </Link>

              {/*
                操作按钮与封面互为兄弟节点而非嵌套：
                链接里不能再放按钮，因此统一由外层的封面组承接悬停态。
              */}
              <div className="cover-card-actions">
                <Link
                  href={`/novels/${novel.id}/workbench`}
                  className="cover-card-action"
                  title={t('shelf.continueWriting')}
                  aria-label={t('shelf.continueWriting')}
                >
                  <i className="fa-solid fa-wand-magic-sparkles" aria-hidden />
                </Link>
                <button
                  type="button"
                  className="cover-card-action"
                  onClick={() => openCoverEdit(novel)}
                  title={t('shelf.editCover')}
                  aria-label={t('shelf.editCover')}
                >
                  <i className="fa-solid fa-camera" aria-hidden />
                </button>
                <button
                  type="button"
                  className="cover-card-action cover-card-action-danger"
                  onClick={() => setPendingDelete(novel)}
                  title={t('shelf.deleteNovel')}
                  aria-label={t('shelf.deleteNovel')}
                >
                  <i className="fa-solid fa-trash-can" aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={coverEditing !== null}
        title={t('shelf.editCover')}
        description={t('shelf.coverHint')}
        size="lg"
        onClose={() => setCoverEditing(null)}
        footer={
          <>
            <Button onClick={() => setCoverEditing(null)}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={saveCover}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <div className="flex flex-col items-center gap-2">
            <NovelCover
              novel={{
                coverEmoji: coverForm.coverEmoji,
                coverImage: coverForm.coverImage,
                coverFit: coverForm.coverFit,
                title: coverEditing?.title ?? '',
              }}
              size="lg"
            />
            <span className="text-[0.68rem] text-ink-faint">{t('common.preview')}</span>
          </div>

          <div className="grid gap-3.5">
            <Field label={t('shelf.coverImage')} hint={t('shelf.coverImageHint')}>
              <div className="flex flex-wrap items-center gap-2">
                <label className="btn cursor-pointer">
                  <i className="fa-solid fa-upload" aria-hidden />
                  {t('shelf.coverUpload')}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => pickCoverFile(event.target.files?.[0])}
                  />
                </label>
                {coverForm.coverImage ? (
                  <Button size="sm" variant="danger" onClick={() => setCoverForm({ ...coverForm, coverImage: '' })}>
                    {t('shelf.coverRemove')}
                  </Button>
                ) : null}
              </div>
            </Field>

            {coverForm.coverImage ? (
              <Field label={t('shelf.coverFit')} hint={t('shelf.coverFitHint')}>
                <Select
                  value={coverForm.coverFit}
                  onChange={(event) =>
                    setCoverForm({ ...coverForm, coverFit: event.target.value as CoverFit })
                  }
                >
                  <option value="cover">{t('shelf.coverFitCover')}</option>
                  <option value="contain">{t('shelf.coverFitContain')}</option>
                </Select>
              </Field>
            ) : (
              <Field label={t('shelf.coverEmoji')} hint={t('shelf.coverEmojiHint')}>
                <div className="flex flex-wrap gap-1.5">
                  {EMOJI_CHOICES.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setCoverForm({ ...coverForm, coverEmoji: emoji })}
                      className={clsx(
                        'flex h-9 w-9 items-center justify-center rounded-[8px] border text-lg transition-colors duration-200',
                        coverForm.coverEmoji === emoji
                          ? 'border-accent-border bg-accent-soft'
                          : 'border-line hover:bg-[var(--glass-bg-sunken)]',
                      )}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </Field>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        open={createOpen}
        title={t('shelf.newNovel')}
        description={t('shelf.emptyHint')}
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button onClick={() => setCreateOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={handleCreate} disabled={busy}>
              {busy ? <Spinner /> : <i className="fa-solid fa-check" aria-hidden />}
              {t('common.create')}
            </Button>
          </>
        }
      >
        <div className="grid gap-3.5">
          <Field label={t('shelf.novelTitle')} required>
            <TextInput
              value={form.title}
              placeholder={t('shelf.titlePlaceholder')}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
          </Field>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label={t('shelf.author')}>
              <TextInput
                value={form.author}
                placeholder={t('shelf.authorPlaceholder')}
                onChange={(event) => setForm({ ...form, author: event.target.value })}
              />
            </Field>
            <Field label={t('shelf.genre')}>
              <TextInput
                value={form.genre}
                placeholder={t('shelf.genrePlaceholder')}
                onChange={(event) => setForm({ ...form, genre: event.target.value })}
              />
            </Field>
          </div>
          <Field label={t('shelf.summary')}>
            <TextArea
              rows={3}
              value={form.summary}
              placeholder={t('shelf.summaryPlaceholder')}
              onChange={(event) => setForm({ ...form, summary: event.target.value })}
            />
          </Field>
          <Field label={t('shelf.coverEmoji')}>
            <div className="flex flex-wrap gap-1.5">
              {EMOJI_CHOICES.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setForm({ ...form, coverEmoji: emoji })}
                  className={clsx(
                    'flex h-9 w-9 items-center justify-center rounded-[8px] border text-lg transition-all duration-200',
                    form.coverEmoji === emoji
                      ? 'border-accent bg-accent-soft'
                      : 'border-line bg-surface-raised hover:bg-surface-soft',
                  )}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </Modal>

      <Modal
        open={importOpen}
        title={t('shelf.importNovel')}
        description={t('shelf.importHint')}
        size="lg"
        onClose={() => setImportOpen(false)}
        footer={
          <>
            <Button onClick={() => setImportOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="primary" onClick={handleImport} disabled={busy}>
              {busy ? <Spinner /> : <i className="fa-solid fa-file-import" aria-hidden />}
              {t('common.import')}
            </Button>
          </>
        }
      >
        <div className="grid gap-3.5">
          <div className="grid gap-3.5 sm:grid-cols-3">
            <Field label={t('shelf.novelTitle')}>
              <TextInput
                value={importForm.title}
                placeholder={t('shelf.titlePlaceholder')}
                onChange={(event) => setImportForm({ ...importForm, title: event.target.value })}
              />
            </Field>
            <Field label={t('shelf.author')}>
              <TextInput
                value={importForm.author}
                onChange={(event) => setImportForm({ ...importForm, author: event.target.value })}
              />
            </Field>
            <Field label={t('shelf.genre')}>
              <TextInput
                value={importForm.genre}
                onChange={(event) => setImportForm({ ...importForm, genre: event.target.value })}
              />
            </Field>
          </div>
          <Field label={t('shelf.importAs')}>
            <Select
              value={importForm.mode}
              onChange={(event) =>
                setImportForm({ ...importForm, mode: event.target.value as 'text' | 'archive' })
              }
            >
              <option value="text">{t('shelf.importText')}</option>
              <option value="archive">{t('shelf.importArchive')}</option>
            </Select>
          </Field>
          <Field label={t('shelf.importPaste')}>
            <TextArea
              rows={12}
              className="font-mono text-xs"
              value={importForm.text}
              placeholder={
                importForm.mode === 'text'
                  ? t('shelf.importPastePlaceholder')
                  : t('shelf.importArchivePlaceholder')
              }
              onChange={(event) => setImportForm({ ...importForm, text: event.target.value })}
            />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('shelf.deleteNovel')}
        message={`${t('shelf.deleteConfirm')}。${t('common.irreversible')}`}
        confirmLabel={t('common.delete')}
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}
