import { SetupClient } from '@/components/novel/SetupClient';

export default async function SetupPage({ params }: { params: Promise<{ novelId: string }> }) {
  const { novelId } = await params;
  return <SetupClient novelId={novelId} />;
}
