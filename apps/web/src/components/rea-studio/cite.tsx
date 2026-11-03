'use client';

import { createContext, useContext } from 'react';
import { Button } from '@open-design/components';
import type { ReaCiteTarget } from '@open-design/contracts';
import { useI18n } from '../../i18n';

/** How a pane asks the Studio to quote one evidence item in the chat; absent where there is no chat to send to. */
export interface ReaCiteApi {
  cite: (target: ReaCiteTarget) => void;
  busy: boolean;
}

export const ReaCiteContext = createContext<ReaCiteApi | null>(null);

/** "Add to chat" for one evidence item. Renders nothing when the Studio has no chat to send to. */
export function CiteButton({ target, label }: { target: ReaCiteTarget; label?: string }) {
  const api = useContext(ReaCiteContext);
  const { t } = useI18n();
  if (!api) return null;
  return <Button variant="ghost" onClick={() => api.cite(target)} disabled={api.busy} data-testid="rea-cite">{label ?? t('reaStudio.cite.button')}</Button>;
}

/** POSTs JSON and returns the parsed body or the daemon's error message. */
export async function postJson<T>(path: string, body: unknown): Promise<{ ok: true; value: T } | { ok: false; message: string }> {
  try {
    const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
      return { ok: false, message: payload.error?.message ?? `HTTP ${response.status}` };
    }
    return { ok: true, value: await response.json() as T };
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : String(error) }; }
}
