import { ChaptersClient } from '@/components/novel/ChaptersClient';

export default async function ChaptersPage({ params }: { params: Promise<{ novelId: string }> }) {
  const { novelId } = await params;
  return <ChaptersClient novelId={novelId} />;
}
