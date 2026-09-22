import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NovelNav } from '@/components/novel/NovelNav';
import { getNovel } from '@/lib/repo/novels';
import { zh } from '@/lib/i18n/zh';

/** 小说级布局。顶部固定作品标题与二级导航，下方渲染具体页面。 */
export default async function NovelLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ novelId: string }>;
}) {
  const { novelId } = await params;
  const novel = getNovel(novelId);
  if (!novel) notFound();

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/"
            className="btn btn-ghost px-2 text-xs"
            aria-label={zh.nav.shelf}
          >
            <i className="fa-solid fa-arrow-left" aria-hidden />
          </Link>
          <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-surface-sunken text-lg">
            {novel.coverEmoji}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-soft">{novel.title}</h1>
            <p className="text-xs text-ink-muted">
              {novel.author || zh.shelf.author}
              {novel.genre ? ` · ${novel.genre}` : ''}
              {` · ${novel.chapterCount} ${zh.shelf.chaptersCount}`}
              {` · ${novel.wordCount.toLocaleString('zh-Hans-CN')} ${zh.shelf.wordsCount}`}
            </p>
          </div>
          <span className="chip ml-auto">{zh.shelf.status[novel.status]}</span>
        </div>
        <div className="border-b border-line pb-2">
          <NovelNav novelId={novelId} />
        </div>
      </header>
      <div className="min-h-[60vh]">{children}</div>
    </div>
  );
}
