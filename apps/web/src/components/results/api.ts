import type {
  RunLogListQuery,
  RunLogListResponse,
  RunOutputDetailResponse,
  RunOutputListQuery,
  RunOutputListResponse,
  RunOutputRestoreResponse,
  RunUsageSummaryResponse,
} from '@open-design/contracts';

export type ResultsCall<T> = { ok: true; value: T } | { ok: false; message: string };

async function call<T>(url: string, init: RequestInit = {}): Promise<ResultsCall<T>> {
  try {
    const response = await fetch(url, init);
    const payload = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
    if (!response.ok) return { ok: false, message: payload.error?.message ?? `HTTP ${response.status}` };
    return { ok: true, value: payload };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

function search(query: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === true) params.set(key, '1');
    else if (typeof value === 'number' || (typeof value === 'string' && value)) params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** The same routes `monofield outputs` and `monofield usage` call. */
export const resultsApi = {
  list: (query: RunOutputListQuery) => call<RunOutputListResponse>(`/api/run-outputs${search(query)}`),
  detail: (id: string) => call<RunOutputDetailResponse>(`/api/run-outputs/${encodeURIComponent(id)}`),
  restore: (id: string) => call<RunOutputRestoreResponse>(`/api/run-outputs/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
  contentUrl: (id: string, download = false) => `/api/run-outputs/${encodeURIComponent(id)}/content${download ? '?download=1' : ''}`,
  runs: (query: RunLogListQuery) => call<RunLogListResponse>(`/api/run-log${search(query)}`),
  usage: (query: RunLogListQuery) => call<RunUsageSummaryResponse>(`/api/run-log/usage${search(query)}`),
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Extensions the content route serves as text, so the preview can show them. */
const TEXT_PREVIEW = new Set(['md', 'txt', 'csv', 'tsv', 'json', 'yaml', 'yml', 'xml', 'html', 'htm']);
const IMAGE_PREVIEW = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']);

export function previewKind(name: string): 'image' | 'text' | 'none' {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_PREVIEW.has(extension)) return 'image';
  return TEXT_PREVIEW.has(extension) ? 'text' : 'none';
}
