import { WorkbenchClient } from '@/components/novel/WorkbenchClient';

export default async function WorkbenchPage({ params }: { params: Promise<{ novelId: string }> }) {
  const { novelId } = await params;
  return <WorkbenchClient novelId={novelId} />;
}
