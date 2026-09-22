import { SearchClient } from '@/components/novel/SearchClient';

export default async function SearchPage({ params }: { params: Promise<{ novelId: string }> }) {
  const { novelId } = await params;
  return <SearchClient novelId={novelId} />;
}
