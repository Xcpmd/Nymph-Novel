import { EventsClient } from '@/components/novel/EventsClient';

export default async function EventsPage({ params }: { params: Promise<{ novelId: string }> }) {
  const { novelId } = await params;
  return <EventsClient novelId={novelId} />;
}
