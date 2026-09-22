import { ShelfClient } from '@/components/shelf/ShelfClient';
import { listNovels } from '@/lib/repo/novels';
import { ensureDefaultProviders } from '@/lib/service/bootstrap';

/** 书架页。首次访问时顺带完成供应商预置。 */
export default function HomePage() {
  ensureDefaultProviders();
  const novels = listNovels();
  return <ShelfClient initialNovels={novels} />;
}
