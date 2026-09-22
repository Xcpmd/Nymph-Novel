import { fail, handle, queryString } from '@/lib/api/http';
import { exportNovel, type ExportFormat } from '@/lib/service/export';

interface RouteParams {
  params: Promise<{ novelId: string }>;
}

const FORMATS: ExportFormat[] = ['txt', 'md', 'json'];

/**
 * GET /api/novels/{novelId}/export?format=txt
 * 直接返回文件流，浏览器会按 Content-Disposition 触发下载。
 */
export async function GET(request: Request, { params }: RouteParams) {
  const { novelId } = await params;
  const url = new URL(request.url);
  const requested = queryString(url, 'format') ?? 'txt';
  const format = (FORMATS.includes(requested as ExportFormat) ? requested : 'txt') as ExportFormat;

  return handle(() => {
    try {
      const result = exportNovel(novelId, format);
      return new Response(result.content, {
        headers: {
          'Content-Type': result.contentType,
          'Content-Disposition': `attachment; filename="${encodeURIComponent(result.fileName)}"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
          'Cache-Control': 'no-store',
        },
      });
    } catch (error) {
      return fail(error instanceof Error ? error.message : '导出失败', 400);
    }
  });
}
