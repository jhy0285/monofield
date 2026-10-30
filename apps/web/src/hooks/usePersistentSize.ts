'use client';

import { useCallback, useEffect, useState } from 'react';

function readStoredSize(key: string): number | null {
  try {
    const parsed = Number.parseFloat(window.localStorage.getItem(key) ?? '');
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
  } catch {
    return null;
  }
}

/**
 * A pane size, in pixels, that a person has dragged to and the app remembers.
 * `stored` is null until they resize, so the caller keeps deciding the default
 * (which often depends on the viewport) instead of freezing it into storage.
 * It is read after mount so server and first client render agree.
 */
export function usePersistentSize(storageKey: string) {
  const [stored, setStored] = useState<number | null>(null);

  useEffect(() => {
    setStored(readStoredSize(storageKey));
  }, [storageKey]);

  /** Follow a drag live without writing storage on every pointer move. */
  const preview = useCallback((next: number) => {
    setStored(Math.round(next));
  }, []);

  const commit = useCallback((next: number) => {
    const size = Math.round(next);
    setStored(size);
    try {
      window.localStorage.setItem(storageKey, String(size));
    } catch {
      // Private mode or blocked storage: the size still holds for this session.
    }
  }, [storageKey]);

  const reset = useCallback(() => {
    setStored(null);
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Nothing was persisted to forget.
    }
  }, [storageKey]);

  return { stored, preview, commit, reset };
}
