'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, novelResourcePath } from '@/lib/client/api';
import { useSettings } from '@/components/providers/SettingsProvider';
import { useToast } from '@/components/ui/Toast';
import { useDebounced } from '@/hooks/useDebounced';
import { Button, EmptyState, Panel, Select, Spinner, TextInput } from '@/components/ui/primitives';
import type { Bookmark, ChapterWithVolume, Tag, Volume } from '@/lib/types';

/** 检索与导航。包含全文检索、标签筛选、书签与目录跳转。 */

interface SearchHit {
  chapterId: string;
  title: string;
  volumeIndex: number;
  chapterIndex: number;
  volumeTitle: string;
  snippet: string;
  score: number;
  matchedIn: 'title' | 'content' | 'both';
}

export function SearchClient({ novelId }: { novelId: string }) {
  const { t } = useSettings();
  const toast = useToast();

  const [keyword, setKeyword] = useState('');
  const [searchResult, setSearchResult] = useState<{ term: string; hits: SearchHit[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const [chapters, setChapters] = useState<ChapterWithVolume[]>([]);
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [tagFilter, setTagFilter] = useState('');
  const [rebuilding, setRebuilding] = useState(false);

  const debouncedKeyword = useDebounced(keyword, 340);
  const term = debouncedKeyword.trim();
  // 命中结果与当前关键词绑定，关键词变化时立即视为无结果，无需额外的状态复位
  const hits = searchResult && searchResult.term === term ? searchResult.hits : [];
  const searched = term.length > 0 && searchResult?.term === term;

  const loadMeta = useCallback(async () => {
    try {
      const [chapterList, volumeList, tagList, bookmarkList] = await Promise.all([
        api.get<ChapterWithVolume[]>(novelResourcePath(novelId, 'chapters')),
        api.get<Volume[]>(novelResourcePath(novelId, 'volumes')),
        api.get<Tag[]>(novelResourcePath(novelId, 'tags')),
        api.get<Bookmark[]>(novelResourcePath(novelId, 'bookmarks')),
      ]);
      setChapters(chapterList);
      setVolumes(volumeList);
      setTags(tagList);
      setBookmarks(bookmarkList);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    }
  }, [novelId, t, toast]);

  useEffect(() => {
    void loadMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novelId]);

  useEffect(() => {
    if (!term) {
      setSearching(false);
      return undefined;
    }
    let cancelled = false;
    setSearching(true);
    api
      .get<{ hits: SearchHit[] }>(`${novelResourcePath(novelId, 'search')}?q=${encodeURIComponent(term)}`)
      .then((result) => {
        if (!cancelled) setSearchResult({ term, hits: result.hits });
      })
      .catch(() => {
        if (!cancelled) setSearchResult({ term, hits: [] });
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [term, novelId]);

  const rebuildIndex = async () => {
    setRebuilding(true);
    try {
      const result = await api.post<{ indexed: number }>(novelResourcePath(novelId, 'index'));
      toast.success(t('search.rebuildDone', { count: result.indexed }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.generateFailed'));
    } finally {
      setRebuilding(false);
    }
  };

  const visibleChapters = tagFilter
    ? chapters.filter((chapter) => (chapter.tags ?? []).some((tag) => tag.id === tagFilter))
    : chapters;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-soft">{t('search.title')}</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-muted">{t('search.hint')}</p>
        </div>
        <Button onClick={rebuildIndex} disabled={rebuilding}>
          {rebuilding ? <Spinner /> : <i className="fa-solid fa-arrows-rotate" aria-hidden />}
          {t('search.rebuildIndex')}
        </Button>
      </header>

      <Panel title={t('search.fullText')}>
        <TextInput
          value={keyword}
          placeholder={t('search.searchPlaceholder')}
          onChange={(event) => setKeyword(event.target.value)}
          className="text-base"
        />
        <div className="mt-3 flex flex-col gap-2">
          {searching ? (
            <div className="flex items-center gap-2 text-xs text-ink-muted">
              <Spinner /> {t('common.loading')}
            </div>
          ) : null}
          {searched && hits.length === 0 && !searching ? (
            <p className="text-sm text-ink-faint">{t('search.noResult')}</p>
          ) : null}
          {hits.length > 0 ? (
            <>
              <p className="text-xs text-ink-faint">
                {t('search.resultCount', { count: hits.length })}
              </p>
              <ul className="flex flex-col gap-2">
                {hits.map((hit) => (
                  <li key={hit.chapterId} className="card animate-rise p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/novels/${novelId}/chapters/${hit.chapterId}`}
                        className="text-sm font-medium text-soft transition-colors duration-200 hover:text-accent-strong"
                      >
                        第{hit.volumeIndex}卷 第{hit.chapterIndex}章 {hit.title}
                      </Link>
                      <span className="chip">{hit.volumeTitle}</span>
                      <span className="chip chip-accent">
                        {t(
                          hit.matchedIn === 'both'
                            ? 'search.matchedInBoth'
                            : hit.matchedIn === 'title'
                              ? 'search.matchedInTitle'
                              : 'search.matchedInContent',
                        )}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{hit.snippet}</p>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title={t('nav.chapters')}
          description={`${visibleChapters.length} ${t('shelf.chaptersCount')}`}
          actions={
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
          }
        >
          {volumes.length === 0 ? (
            <EmptyState title={t('common.empty')} />
          ) : (
            <div className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto pr-1">
              {volumes.map((volume) => {
                const list = visibleChapters.filter((chapter) => chapter.volumeId === volume.id);
                if (list.length === 0) return null;
                return (
                  <div key={volume.id}>
                    <p className="panel-title mb-1.5">
                      第{volume.indexNo}卷 {volume.title}
                    </p>
                    <ul className="flex flex-col gap-0.5">
                      {list.map((chapter) => (
                        <li key={chapter.id}>
                          <Link
                            href={`/novels/${novelId}/chapters/${chapter.id}`}
                            className={clsx(
                              'nav-item justify-between',
                              chapter.wordCount === 0 && 'opacity-60',
                            )}
                          >
                            <span className="truncate">
                              {String(chapter.indexNo).padStart(3, '0')} {chapter.title}
                            </span>
                            <span className="shrink-0 text-xs text-ink-faint">
                              {chapter.wordCount}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel title={t('search.bookmarks')}>
          {bookmarks.length === 0 ? (
            <p className="text-sm text-ink-faint">{t('search.noBookmarks')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {bookmarks.map((bookmark) => (
                <li key={bookmark.id} className="py-2.5">
                  <Link
                    href={`/novels/${novelId}/chapters/${bookmark.chapterId}`}
                    className="text-sm text-soft transition-colors duration-200 hover:text-accent-strong"
                  >
                    {bookmark.label || bookmark.chapterTitle}
                  </Link>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    第{bookmark.volumeIndex}卷 第{bookmark.chapterIndex}章 {bookmark.chapterTitle}
                  </p>
                  {bookmark.anchor || bookmark.note ? (
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-faint">
                      {bookmark.anchor || bookmark.note}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
