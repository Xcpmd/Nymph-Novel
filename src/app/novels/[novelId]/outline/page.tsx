import { OutlineClient } from '@/components/novel/OutlineClient';

export default async function OutlinePage({ params }: { params: Promise<{ novelId: string }> }) {
  const { novelId } = await params;
  return <OutlineClient novelId={novelId} />;
}
