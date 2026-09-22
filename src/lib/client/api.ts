/**
 * 浏览器侧的接口调用封装。
 * 统一处理错误消息提取，避免每个组件重复写 try catch 与响应解析。
 */

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: unknown = null;
  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const detail =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `请求失败，状态码 ${response.status}`;
    throw new ApiError(detail, response.status);
  }
  return payload as T;
}

/** 发起 JSON 请求。 */
export async function apiRequest<T>(
  path: string,
  options: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, headers, ...rest } = options;
  const response = await fetch(path, {
    ...rest,
    headers: {
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: 'no-store',
  });
  return parseResponse<T>(response);
}

export const api = {
  get: <T>(path: string) => apiRequest<T>(path),
  post: <T>(path: string, json?: unknown) => apiRequest<T>(path, { method: 'POST', json }),
  patch: <T>(path: string, json?: unknown) => apiRequest<T>(path, { method: 'PATCH', json }),
  put: <T>(path: string, json?: unknown) => apiRequest<T>(path, { method: 'PUT', json }),
  delete: <T>(path: string) => apiRequest<T>(path, { method: 'DELETE' }),
};

/** 小说内资源的统一路径构造，避免各处拼接字符串出错。 */
export function novelResourcePath(novelId: string, resource: string, itemId?: string): string {
  const base = `/api/novels/${encodeURIComponent(novelId)}/${resource}`;
  return itemId ? `${base}/${encodeURIComponent(itemId)}` : base;
}

/** 触发浏览器下载。 */
export function downloadFile(url: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

/** 把字节数格式化为易读文本。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} 字节`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** 把数字格式化为带千分位的文本。 */
export function formatNumber(value: number): string {
  return value.toLocaleString('zh-Hans-CN');
}

/** 格式化时间戳。 */
export function formatDateTime(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('zh-Hans-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
