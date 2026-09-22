import { RelationsClient } from '@/components/novel/RelationsClient';

export default async function RelationsPage({ params }: { params: Promise<{ novelId: string }> }) {
  const { novelId } = await params;
  return <RelationsClient novelId={novelId} />;
}
