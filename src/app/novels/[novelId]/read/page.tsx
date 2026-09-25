import { ReaderClient } from '@/components/novel/ReaderClient';

export default async function ReadPage({
  params,
  searchParams,
}: {
  params: Promise<{ novelId: string }>;
  searchParams: Promise<{ ch?: string; mode?: string }>;
}) {
  const { novelId } = await params;
  const { ch, mode } = await searchParams;
  return <ReaderClient novelId={novelId} initialChapterId={ch ?? ''} initialMode={mode ?? ''} />;
}
