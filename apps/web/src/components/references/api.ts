import type {
  ReferenceApplyRequest,
  ReferenceApplyResponse,
  ReferenceCreateRequest,
  ReferenceItem,
  ReferenceListResponse,
  ReferenceUpdateRequest,
} from '@open-design/contracts';

/** `network` marks a request that never reached the daemon (no HTTP answer). */
export type ReferenceResult<T> = { ok: true; value: T } | { ok: false; message: string; network?: boolean };

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/references`;

async function call<T>(url: string, init: RequestInit = {}): Promise<ReferenceResult<T>> {
  try {
    const response = await fetch(url, init);
    const payload = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
    if (!response.ok) return { ok: false, message: payload.error?.message ?? `HTTP ${response.status}` };
    return { ok: true, value: payload };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error), network: true };
  }
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** The same routes `monofield refs` calls. */
export const referencesApi = {
  list: (projectId: string) => call<ReferenceListResponse>(base(projectId)),
  add: (projectId: string, body: ReferenceCreateRequest) => call<{ item: ReferenceItem }>(base(projectId), json('POST', body)),
  update: (projectId: string, id: string, body: ReferenceUpdateRequest) => call<{ item: ReferenceItem }>(`${base(projectId)}/${encodeURIComponent(id)}`, json('PATCH', body)),
  remove: (projectId: string, id: string) => call<{ removed: string; files: string[] }>(`${base(projectId)}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  apply: (projectId: string, body: ReferenceApplyRequest) => call<ReferenceApplyResponse>(`${base(projectId)}/apply`, json('POST', body)),
};
