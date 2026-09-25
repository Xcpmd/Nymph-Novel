'use client';

import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSettings } from '@/components/providers/SettingsProvider';

/** 小说内部的二级导航。桌面端横向排布，移动端横向滚动。 */

const ITEMS: Array<{ segment: string; icon: string; labelKey: string }> = [
  { segment: '', icon: 'fa-solid fa-gauge-high', labelKey: 'nav.overview' },
  { segment: 'workbench', icon: 'fa-solid fa-wand-magic-sparkles', labelKey: 'nav.workbench' },
  { segment: 'setup', icon: 'fa-solid fa-scroll', labelKey: 'nav.setup' },
  { segment: 'events', icon: 'fa-solid fa-flag', labelKey: 'nav.events' },
  { segment: 'outline', icon: 'fa-solid fa-diagram-project', labelKey: 'nav.outline' },
  { segment: 'chapters', icon: 'fa-solid fa-list-ol', labelKey: 'nav.chapters' },
  // 阅读放在章节目录之后：先看到目录，再沉进正文
  { segment: 'read', icon: 'fa-solid fa-book-open-reader', labelKey: 'nav.read' },
  { segment: 'characters', icon: 'fa-solid fa-users', labelKey: 'nav.characters' },
  { segment: 'relations', icon: 'fa-solid fa-share-nodes', labelKey: 'nav.relations' },
  { segment: 'encyclopedia', icon: 'fa-solid fa-book-atlas', labelKey: 'nav.encyclopedia' },
  { segment: 'timeline', icon: 'fa-solid fa-timeline', labelKey: 'nav.timeline' },
  { segment: 'search', icon: 'fa-solid fa-magnifying-glass', labelKey: 'nav.search' },
  { segment: 'data', icon: 'fa-solid fa-right-left', labelKey: 'nav.data' },
  { segment: 'usage', icon: 'fa-solid fa-chart-simple', labelKey: 'nav.usage' },
];

export function NovelNav({ novelId }: { novelId: string }) {
  const pathname = usePathname();
  const { t } = useSettings();
  const base = `/novels/${novelId}`;
  const scrollerRef = useRef<HTMLElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });

  const isActive = (segment: string) => {
    const href = segment ? `${base}/${segment}` : base;
    if (segment === 'chapters' && pathname.startsWith(`${base}/chapters/`)) return true;
    return pathname === href;
  };

  /** 记录导航条左右是否还有被裁掉的内容，用于显示滚动提示。 */
  const measure = () => {
    const node = scrollerRef.current;
    if (!node) return;
    setOverflow({
      left: node.scrollLeft > 2,
      right: node.scrollLeft + node.clientWidth < node.scrollWidth - 2,
    });
  };

  useEffect(() => {
    measure();
    const node = scrollerRef.current;
    if (!node) return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [pathname]);

  return (
    <div className="relative">
      <nav
        ref={scrollerRef}
        onScroll={measure}
        className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1"
      >
        {ITEMS.map((item) => {
          const href = item.segment ? `${base}/${item.segment}` : base;
          const active = isActive(item.segment);
          return (
            <Link
              key={item.segment || 'overview'}
              href={href}
              className={clsx(
                'flex shrink-0 items-center gap-1.5 rounded-[6px] px-2.5 py-1.5 text-[0.82rem] whitespace-nowrap transition-colors duration-200',
                active
                  ? 'bg-accent-soft font-semibold text-accent-strong'
                  : 'text-ink-muted hover:bg-[var(--glass-bg-sunken)] hover:text-ink',
              )}
            >
              <i className={clsx(item.icon, 'text-[0.78rem]')} aria-hidden />
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>
      {overflow.right ? (
        <span
          className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-surface-raised to-transparent"
          aria-hidden
        />
      ) : null}
      {overflow.left ? (
        <span
          className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-surface-raised to-transparent"
          aria-hidden
        />
      ) : null}
    </div>
  );
}
