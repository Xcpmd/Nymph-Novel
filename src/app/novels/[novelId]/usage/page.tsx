import { UsageClient } from '@/components/novel/UsageClient';

export default async function UsagePage({ params }: { params: Promise<{ novelId: string }> }) {
  const { novelId } = await params;
  return <UsageClient novelId={novelId} />;
}
