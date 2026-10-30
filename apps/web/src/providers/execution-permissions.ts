import { useCallback, useEffect, useState } from 'react';
import type {
  ExecutionPermissionLevel,
  ExecutionPermissionsResponse,
  UpdateExecutionPermissionsRequest,
} from '@open-design/contracts';

/** Fired on `window` after a save so every reader (Settings, the header badge) refreshes. */
export const EXECUTION_PERMISSIONS_CHANGED_EVENT = 'monofield:execution-permissions-changed';

async function readPermissions(response: Response, fallback: string): Promise<ExecutionPermissionsResponse> {
  if (!response.ok) {
    let message = fallback;
    try {
      const body = (await response.json()) as { error?: string | { message?: string } };
      message = typeof body.error === 'string' ? body.error : body.error?.message ?? fallback;
    } catch {
      // keep the fallback
    }
    throw new Error(message);
  }
  return (await response.json()) as ExecutionPermissionsResponse;
}

export async function fetchExecutionPermissions(): Promise<ExecutionPermissionsResponse> {
  return readPermissions(await fetch('/api/execution-permissions'), 'Could not load execution permissions');
}

export async function saveExecutionPermissionLevel(level: ExecutionPermissionLevel): Promise<ExecutionPermissionsResponse> {
  const body: UpdateExecutionPermissionsRequest = { level };
  const saved = await readPermissions(
    await fetch('/api/execution-permissions', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    'Could not save execution permissions',
  );
  window.dispatchEvent(new CustomEvent(EXECUTION_PERMISSIONS_CHANGED_EVENT, { detail: saved }));
  return saved;
}

/**
 * The daemon's execution permissions, kept fresh across the app. `null`
 * until the first answer, and stays `null` when the daemon cannot be reached
 * (readers then show nothing rather than guess).
 */
export function useExecutionPermissions(): {
  permissions: ExecutionPermissionsResponse | null;
  error: Error | null;
  refresh: () => Promise<void>;
} {
  const [permissions, setPermissions] = useState<ExecutionPermissionsResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPermissions(await fetchExecutionPermissions());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<ExecutionPermissionsResponse | undefined>).detail;
      if (detail) setPermissions(detail);
      else void refresh();
    };
    window.addEventListener(EXECUTION_PERMISSIONS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(EXECUTION_PERMISSIONS_CHANGED_EVENT, onChanged);
  }, [refresh]);

  return { permissions, error, refresh };
}
