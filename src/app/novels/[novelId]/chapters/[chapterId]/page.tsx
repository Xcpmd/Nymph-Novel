import { ChapterDetailClient } from '@/components/novel/ChapterDetailClient';

export default async function ChapterDetailPage({
  params,
}: {
  params: Promise<{ novelId: string; chapterId: string }>;
}) {
  const { novelId, chapterId } = await params;
  return <ChapterDetailClient novelId={novelId} chapterId={chapterId} />;
}
