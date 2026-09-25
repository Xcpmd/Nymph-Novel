'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, novelResourcePath } from '@/lib/client/api';
import { useSettings } from '@/components/providers/SettingsProvider';
import { useToast } from '@/components/ui/Toast';
import { Button, Select, Spinner } from '@/components/ui/primitives';
import { MarkdownEditor } from '@/components/markdown/MarkdownEditor';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import { buildSpeakerColors } from '@/lib/markdown/speakers';
import type { ChapterWithVolume, Character } from '@/lib/types';

/**
 * 阅读模式。
 *
 * paged 与 instant 都是左右翻页，区别只在翻页时是否有过渡动画：
 * 动画在短距离内帮助理解「翻过去了」，但连续快速翻页时会拖慢节奏，
 * 因此单独给一个无动画的选项。
 * scroll 是上下滚动，章节之间首尾相连。
 */
export type ReaderMode = 'paged' | 'instant' | 'scroll';

const MODE_KEYS: Array<{ value: ReaderMode; labelKey: string; icon: string }> = [
  { value: 'paged', labelKey: 'reader.modePaged', icon: 'fa-solid fa-book-open' },
  { value: 'instant', labelKey: 'reader.modeInstant', icon: 'fa-solid fa-bolt' },
  { value: 'scroll', labelKey: 'reader.modeScroll', icon: 'fa-solid fa-arrows-up-down' },
];

/**
 * 阅读页。
 *
 * 默认是渲染后的阅读视图，切到编辑模式才出现编辑框 ——
 * 打开这个页面的目的是读，不是改，编辑器不该抢在第一眼。
 *
 * 正文不缓存草稿而直接落库：阅读页里的改动是明确的编辑动作，
 * 留着未保存内容反而会让下次打开看到的版本与磁盘不一致。
 */
export function ReaderClient({
  novelId,
  initialChapterId,
  initialMode,
}: {
  novelId: string;
  initialChapterId: string;
  initialMode: string;
}) {
  const { t, settings, update } = useSettings();
  const toast = useToast();

  const [chapters, setChapters] = useState<ChapterWithVolume[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [chapterId, setChapterId] = useState(initialChapterId);
  const [content, setContent] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const [mode, setMode] = useState<ReaderMode>(() =>
    initialMode === 'paged' || initialMode === 'instant' || initialMode === 'scroll'
      ? initialMode
      : 'scroll',
  );

  /** 分页模式下的当前页序号 */
  const [page, setPage] = useState(0);
  /** 分页模式下当前章的页数 */
  const [totalPages, setTotalPages] = useState(1);
  /** 上下滚动模式下已经拼在一起的章节区间 */
  const [stream, setStream] = useState<Array<{ id: string; title: string; text: string }>>([]);

  const viewportRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const speakers = useMemo(() => buildSpeakerColors(characters), [characters]);

  /** 只有能读到正文的章节才参与阅读，空章与废案章跳过。 */
  const readable = useMemo(
    () => chapters.filter((chapter) => chapter.status !== 'scrapped'),
    [chapters],
  );
  const currentIndex = readable.findIndex((chapter) => chapter.id === chapterId);

  const loadChapters = useCallback(async () => {
    const [list, people] = await Promise.all([
      api.get<ChapterWithVolume[]>(novelResourcePath(novelId, 'chapters')),
      api.get<Character[]>(novelResourcePath(novelId, 'characters')),
    ]);
    const ordered = Array.isArray(list) ? list : [];
    setChapters(ordered);
    setCharacters(Array.isArray(people) ? people : []);
    // 没有指定章节时从第一章开始
    setChapterId((current) => current || (ordered.filter((c) => c.status !== 'scrapped')[0]?.id ?? ''));
    setLoading(false);
  }, [novelId]);

  const loadContent = useCallback(
    async (id: string) => {
      if (!id) {
        setContent('');
        return;
      }
      try {
        const result = await api.get<{ chapter: ChapterWithVolume; content: string }>(
          novelResourcePath(novelId, 'chapters', id),
        );
        setContent(result.content ?? '');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
      }
    },
    [novelId, t, toast],
  );

  useEffect(() => {
    void loadChapters();
  }, [loadChapters]);

  useEffect(() => {
    setPage(0);
    void loadContent(chapterId);
  }, [chapterId, loadContent]);

  /*
   * 上下滚动模式把当前章与相邻章拼成一个连续文档。
   * 只放三章：足够在读到边界时自然接上，又不至于一次渲染整本书。
   */
  useEffect(() => {
    if (mode !== 'scroll' || editing || readable.length === 0) return;
    const index = readable.findIndex((chapter) => chapter.id === chapterId);
    if (index < 0) return;
    const window = readable.slice(index, index + 3);
    let cancelled = false;
    void (async () => {
      const parts = await Promise.all(
        window.map(async (chapter) => {
          if (chapter.id === chapterId) return { id: chapter.id, title: chapter.title, text: content };
          try {
            const result = await api.get<{ content: string }>(
              novelResourcePath(novelId, 'chapters', chapter.id),
            );
            return { id: chapter.id, title: chapter.title, text: result.content ?? '' };
          } catch {
            return { id: chapter.id, title: chapter.title, text: '' };
          }
        }),
      );
      if (!cancelled) setStream(parts);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, editing, chapterId, content, readable, novelId]);

  /** 分页模式测量页数。列宽固定为一页宽，因此页数就是总宽除以单页步长。 */
  useEffect(() => {
    if (mode === 'scroll' || editing) return;
    const node = pagesRef.current;
    const viewport = viewportRef.current;
    if (!node || !viewport) return;

    const PADDING = 40;
    const GAP = 40;

    const measure = () => {
      const pageWidth = Math.max(240, viewport.clientWidth - PADDING * 2);
      node.style.setProperty('--page-width', `${pageWidth}px`);
      node.style.setProperty('--page-gap', `${GAP}px`);
      node.style.setProperty('--page-step', `${pageWidth + GAP}px`);
      // 一页宽固定后，总宽除以步长就是页数；末尾余量不足一页也算一页
      const pages = Math.max(1, Math.round((node.scrollWidth + GAP) / (pageWidth + GAP)));
      setTotalPages(pages);
      setPage((current) => Math.min(current, pages - 1));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [mode, editing, content]);

  /** 跳到指定章节。 */
  const goToChapter = useCallback((id: string) => {
    setChapterId(id);
    setPage(0);
    // 切章后回到顶部，否则滚动模式会停在上一章的位置
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    });
  }, []);

  /** 翻页。跨过本章边界时自动接上下一章或上一章。 */
  const turn = useCallback(
    (delta: number) => {
      if (mode === 'scroll') return;
      const next = page + delta;
      if (next >= 0 && next < totalPages) {
        setPage(next);
        return;
      }
      const target = readable[currentIndex + (delta > 0 ? 1 : -1)];
      if (!target) return;
      goToChapter(target.id);
      // 向前翻时落在上一章最后一页，向后翻落在第一页
      setPage(delta > 0 ? 0 : Number.MAX_SAFE_INTEGER);
    },
    [mode, page, totalPages, readable, currentIndex, goToChapter],
  );

  // 上一章最后一页的页码要等新内容测量完才知道，这里把越界值收敛回去
  useEffect(() => {
    if (page === Number.MAX_SAFE_INTEGER) setPage(Math.max(0, totalPages - 1));
  }, [page, totalPages]);

  const persist = async () => {
    if (!chapterId) return;
    setSaving(true);
    try {
      await api.patch(novelResourcePath(novelId, 'chapters', chapterId), { content });
      toast.success(t('common.saved'));
      setEditing(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    } finally {
      setSaving(false);
    }
  };

  /** 键盘翻页。编辑态下交给编辑器自己处理。 */
  useEffect(() => {
    if (editing) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault();
        if (mode === 'scroll') {
          scrollRef.current?.scrollBy({ top: (scrollRef.current?.clientHeight ?? 0) * 0.9 });
        } else {
          turn(1);
        }
      } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault();
        if (mode === 'scroll') {
          scrollRef.current?.scrollBy({ top: -(scrollRef.current?.clientHeight ?? 0) * 0.9 });
        } else {
          turn(-1);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editing, mode, turn]);

  /** 滚动模式下滚到本章末尾时，把区间往后挪一章。 */
  const onScroll = () => {
    const node = scrollRef.current;
    if (!node || readIndexAtEnd(node) === false) return;
    const next = readable[currentIndex + 1];
    if (!next) return;
    setChapterId(next.id);
  };

  const currentChapter = readable[currentIndex];

  return (
    <div className="flex flex-col gap-3">
      {/* 工具条 */}
      <div className="card flex flex-wrap items-center gap-2 px-3 py-2">
        <Select
          value={chapterId}
          onChange={(event) => goToChapter(event.target.value)}
          className="max-w-[22rem]"
        >
          {readable.map((chapter) => (
            <option key={chapter.id} value={chapter.id}>
              第{chapter.indexNo}章 {chapter.title}
            </option>
          ))}
        </Select>

        <div className="flex items-center gap-1 rounded-[8px] border border-[var(--glass-border)] p-0.5">
          {MODE_KEYS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => {
                setMode(item.value);
                setPage(0);
              }}
              title={t(item.labelKey)}
              aria-pressed={mode === item.value}
              className={clsx(
                'flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-xs transition',
                mode === item.value
                  ? 'bg-accent text-white'
                  : 'text-ink-muted hover:text-soft',
              )}
            >
              <i className={item.icon} aria-hidden />
              <span className="hidden sm:inline">{t(item.labelKey)}</span>
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-ink-muted">
            <i className="fa-solid fa-font text-[0.72rem]" aria-hidden />
            <input
              type="range"
              min={14}
              max={30}
              value={settings.readerFontSize}
              onChange={(event) => void update({ readerFontSize: Number(event.target.value) })}
              className="w-20"
              aria-label={t('settings.readerFontSize')}
            />
          </label>
          <Button
            size="sm"
            onClick={() => setEditing((value) => !value)}
            aria-pressed={editing}
          >
            <i className={editing ? 'fa-solid fa-book-open-reader' : 'fa-solid fa-pen'} aria-hidden />
            {editing ? t('reader.toRead') : t('reader.toEdit')}
          </Button>
          <Link className="btn btn-sm" href={`/novels/${novelId}/chapters/${chapterId || ''}`}>
            <i className="fa-solid fa-sliders" aria-hidden />
            {t('reader.detail')}
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="card flex items-center justify-center gap-2 p-10 text-sm text-ink-muted">
          <Spinner />
          {t('common.loading')}
        </div>
      ) : editing ? (
        /* 编辑模式：明确保存，避免阅读页里留下未落库的改动 */
        <div className="card flex flex-col gap-3 p-4">
          <MarkdownEditor value={content} onChange={setContent} speakers={speakers} />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => void persist()} disabled={saving}>
              {saving ? <Spinner /> : <i className="fa-solid fa-floppy-disk" aria-hidden />}
              {t('common.save')}
            </Button>
            <Button onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
            <span className="text-xs text-ink-faint">{t('reader.editHint')}</span>
          </div>
        </div>
      ) : mode === 'scroll' ? (
        /* 上下无缝滑动：章节首尾相接，滚动即可一路读下去 */
        <div
          ref={scrollRef}
          className="reader-scroll card"
          onScroll={onScroll}
          tabIndex={0}
        >
          {stream.map((part) => (
            <section key={part.id} className="reader-section">
              <h2 className="reader-section-title">
                {readable.find((chapter) => chapter.id === part.id)?.title ?? ''}
              </h2>
              {part.text.trim() ? (
                <MarkdownView
                  content={part.text}
                  speakers={speakers}
                  showSpeakerName={settings.showSpeakerName}
                />
              ) : (
                <p className="text-sm text-ink-faint">{t('reader.emptyChapter')}</p>
              )}
            </section>
          ))}
          {!readable[currentIndex + 1] ? (
            <p className="py-6 text-center text-xs text-ink-faint">{t('reader.endOfNovel')}</p>
          ) : null}
        </div>
      ) : (
        /* 左右翻页：一页一屏，点空白或方向键翻动 */
        <div ref={viewportRef} className="reader-viewport card" onClick={() => turn(1)}>
          <div
            ref={pagesRef}
            className={clsx('reader-pages', mode === 'paged' && 'reader-pages-animated')}
            style={{ transform: `translateX(calc(-1 * var(--page-step, 100%) * ${page}))` }}
          >
            <MarkdownView
              content={content}
              speakers={speakers}
              showSpeakerName={settings.showSpeakerName}
            />
          </div>

          <div className="reader-pager" onClick={(event) => event.stopPropagation()}>
            <Button size="sm" onClick={() => turn(-1)} disabled={page <= 0 && currentIndex <= 0}>
              <i className="fa-solid fa-chevron-left" aria-hidden />
            </Button>
            <span className="font-mono text-xs text-ink-muted">
              {page + 1} / {totalPages}
            </span>
            <Button
              size="sm"
              onClick={() => turn(1)}
              disabled={page >= totalPages - 1 && currentIndex >= readable.length - 1}
            >
              <i className="fa-solid fa-chevron-right" aria-hidden />
            </Button>
          </div>
        </div>
      )}

      {!editing && mode !== 'scroll' ? (
        <div className="flex items-center gap-2 text-xs text-ink-faint">
          <span>{t('reader.turnHint')}</span>
          {currentChapter ? (
            <span className="ml-auto">
              {t('chapters.wordCount')}：{currentChapter.wordCount}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** 判断滚动容器是否已经接近底部。 */
function readIndexAtEnd(node: HTMLDivElement): boolean {
  return node.scrollTop + node.clientHeight >= node.scrollHeight - 240;
}
