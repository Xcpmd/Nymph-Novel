import { TimelineClient } from '@/components/novel/TimelineClient';

export default async function TimelinePage({ params }: { params: Promise<{ novelId: string }> }) {
  const { novelId } = await params;
  return <TimelineClient novelId={novelId} />;
}
