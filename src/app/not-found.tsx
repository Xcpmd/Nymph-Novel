import Link from 'next/link';
import { zh } from '@/lib/i18n/zh';

/** 未找到页面。 */
export default function NotFound() {
  return (
    <div className="card mx-auto mt-16 max-w-lg p-8 text-center">
      <i className="fa-solid fa-compass text-3xl text-ink-faint" aria-hidden />
      <h1 className="mt-3 text-lg font-semibold text-soft">页面不存在</h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        目标内容可能已被删除，或者地址输入有误。
      </p>
      <Link href="/" className="btn btn-primary mt-5">
        {zh.nav.shelf}
      </Link>
    </div>
  );
}
