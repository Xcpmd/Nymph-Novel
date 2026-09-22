'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/client/api';
import { useSettings } from '@/components/providers/SettingsProvider';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { FluidBackdrop } from '@/components/layout/FluidBackdrop';
import { SettingsDialog } from '@/components/settings/SettingsDialog';
import type { Novel } from '@/lib/types';

/**
 * 应用外壳。
 * 顶部为固定导航栏，左侧是品牌与作品切换，右侧是主题切换与设置。
 * 设置不再单独占一个页面，而是以中间弹窗的形式打开。
 */

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { t } = useSettings();
  const [shelfOpen, setShelfOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [novels, setNovels] = useState<Novel[]>([]);

  // 带着 settings=1 进来时自动打开设置弹窗，兼容旧的 /settings 链接
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('settings') === '1') {
      setSettingsOpen(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ novels: Novel[] }>('/api/novels')
      .then((result) => {
        if (!cancelled) setNovels(result.novels);
      })
      .catch(() => {
        if (!cancelled) setNovels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  // 路由变化时收起作品下拉
  useEffect(() => {
    setShelfOpen(false);
  }, [pathname]);

  const isShelf = pathname === '/';
  const activeNovelId = pathname.startsWith('/novels/') ? pathname.split('/')[2] : undefined;
  const activeNovel = novels.find((novel) => novel.id === activeNovelId);

  return (
    <div className="relative min-h-screen">
      <FluidBackdrop />

      <header className="glass sticky top-0 z-30 border-b border-[var(--glass-border)]">
        <div className="mx-auto flex h-12 w-full max-w-[100rem] items-center gap-2 px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-accent text-white">
              <i className="fa-solid fa-feather-pointed text-[0.78rem]" aria-hidden />
            </span>
            <span className="hidden text-sm font-semibold text-soft sm:inline">
              {t('meta.appName')}
            </span>
          </Link>

          <span className="mx-1 hidden h-5 w-px bg-line sm:block" aria-hidden />

          <nav className="flex shrink-0 items-center gap-0.5">
            <Link
              href="/"
              className={clsx(
                'flex items-center gap-1.5 rounded-[6px] px-2.5 py-1.5 text-[0.82rem] transition-colors duration-200',
                isShelf
                  ? 'bg-accent-soft font-semibold text-accent-strong'
                  : 'text-ink-muted hover:bg-[var(--glass-bg-sunken)] hover:text-ink',
              )}
            >
              <i className="fa-solid fa-book-open text-[0.78rem]" aria-hidden />
              {t('nav.shelf')}
            </Link>
          </nav>

          {/* 作品切换：当前作品直接展示，其余作品收进下拉 */}
          {novels.length > 0 ? (
            <div className="relative min-w-0">
              <button
                type="button"
                onClick={() => setShelfOpen((value) => !value)}
                className={clsx(
                  'flex max-w-[14rem] items-center gap-1.5 rounded-[6px] px-2.5 py-1.5 text-[0.82rem] transition-colors duration-200',
                  activeNovel
                    ? 'bg-accent-soft font-semibold text-accent-strong'
                    : 'text-ink-muted hover:bg-[var(--glass-bg-sunken)] hover:text-ink',
                )}
                aria-expanded={shelfOpen}
              >
                <i className="fa-solid fa-book shrink-0 text-[0.78rem]" aria-hidden />
                <span className="truncate">{activeNovel?.title ?? t('shelf.choose')}</span>
                <i className="fa-solid fa-chevron-down shrink-0 text-[0.62rem]" aria-hidden />
              </button>

              {shelfOpen ? (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShelfOpen(false)} />
                  <div className="dropdown-panel animate-rise absolute top-full left-0 z-50 mt-2 max-h-80 w-64 overflow-y-auto p-1.5">
                    {novels.map((novel) => (
                      <Link
                        key={novel.id}
                        href={`/novels/${novel.id}`}
                        className="dropdown-item"
                        data-selected={novel.id === activeNovelId}
                      >
                        {novel.coverImage ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={novel.coverImage}
                            alt=""
                            className="h-6 w-6 shrink-0 rounded-[4px] object-cover"
                          />
                        ) : (
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] bg-surface-sunken text-[0.72rem]">
                            {novel.coverEmoji}
                          </span>
                        )}
                        <span className="min-w-0 flex-1 truncate">{novel.title}</span>
                        <span className="shrink-0 text-[0.62rem] text-ink-faint">
                          {novel.chapterCount}
                        </span>
                      </Link>
                    ))}
                    <Link
                      href="/"
                      className="dropdown-item mt-1 border-t border-[var(--glass-border)] pt-2"
                    >
                      <i className="fa-solid fa-plus text-[0.72rem]" aria-hidden />
                      {t('shelf.newNovel')}
                    </Link>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          <div className="ml-auto flex shrink-0 items-center gap-1">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="flex items-center gap-1.5 rounded-[6px] px-2.5 py-1.5 text-[0.82rem] text-ink-muted transition-colors duration-200 hover:bg-[var(--glass-bg-sunken)] hover:text-ink"
              aria-label={t('nav.settings')}
            >
              <i className="fa-solid fa-sliders text-[0.82rem]" aria-hidden />
              <span className="hidden sm:inline">{t('nav.settings')}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        <div className="mx-auto w-full max-w-[100rem] px-4 py-6 sm:px-6 lg:px-8">{children}</div>
      </main>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
