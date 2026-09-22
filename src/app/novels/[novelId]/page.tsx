import Link from 'next/link';
import { getNovel, listChapters, listVolumes } from '@/lib/repo/novels';
import { listCharacters, listEncyclopedia, listRelations, listTimelineEvents } from '@/lib/repo/story';
import { summarizeUsage } from '@/lib/repo/library';
import { getNovelDiskUsage } from '@/lib/store/chapter-files';
import { NovelOverview } from '@/components/novel/NovelOverview';
import { zh } from '@/lib/i18n/zh';

/** 作品概览。数据全部在服务端读取，界面只负责呈现。 */
export default async function NovelOverviewPage({
  params,
}: {
  params: Promise<{ novelId: string }>;
}) {
  const { novelId } = await params;
  const novel = getNovel(novelId);
  if (!novel) {
    return (
      <div className="card p-6 text-sm text-ink-muted">
        {zh.errors.novelNotFound}
        <Link href="/" className="ml-2 underline">
          {zh.nav.shelf}
        </Link>
      </div>
    );
  }

  const chapters = listChapters(novelId);
  const volumes = listVolumes(novelId);
  const characters = listCharacters(novelId);
  const relations = listRelations(novelId);
  const encyclopedia = listEncyclopedia(novelId);
  const events = listTimelineEvents(novelId);
  const usage = summarizeUsage(novelId);
  const diskUsage = getNovelDiskUsage(novelId);

  const generated = chapters.filter((chapter) => chapter.status === 'generated' || chapter.status === 'revised');
  const totalWords = chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
  const averageWords = generated.length > 0 ? Math.round(totalWords / generated.length) : 0;

  return (
    <NovelOverview
      novel={novel}
      stats={{
        volumes: volumes.length,
        chapters: chapters.length,
        generated: generated.length,
        totalWords,
        averageWords,
        characters: characters.length,
        relations: relations.length,
        encyclopedia: encyclopedia.length,
        events: events.length,
        diskUsage,
        usage,
      }}
      recentChapters={chapters.slice(-6).reverse()}
      hasWorldview={novel.id.length > 0}
    />
  );
}
