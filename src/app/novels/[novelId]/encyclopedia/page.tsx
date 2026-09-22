import { EncyclopediaClient } from '@/components/novel/EncyclopediaClient';

export default async function EncyclopediaPage({
  params,
}: {
  params: Promise<{ novelId: string }>;
}) {
  const { novelId } = await params;
  return <EncyclopediaClient novelId={novelId} />;
}
