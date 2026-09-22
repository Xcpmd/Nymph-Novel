import { CharactersClient } from '@/components/novel/CharactersClient';

export default async function CharactersPage({ params }: { params: Promise<{ novelId: string }> }) {
  const { novelId } = await params;
  return <CharactersClient novelId={novelId} />;
}
