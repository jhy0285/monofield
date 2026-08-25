// Shared GitHub star-count hook backing the topbar pill
// (`GithubStarBadge`). The browser talks only to the local daemon,
// which caches GitHub metadata and can return stale values only when
// the daemon has a previously fetched value. This keeps Electron / prerelease builds
// out of the business of making unauthenticated GitHub requests from
// the renderer.

import { useEffect, useState } from 'react';
import type { OpenDocsGithubRepoResponse } from '@open-design/contracts';

const API = '/api/github/open-docs';
const REPO = 'https://github.com/jhy0285/monofield';
const LS_KEY = 'open-docs:gh-stars:v2';
const FAILURE_LS_KEY = 'open-docs:gh-stars:last-failure:v2';
export const GITHUB_STARS_FALLBACK_LABEL = '-';

// One-hour soft cache — long enough to dodge GitHub's 60/hr
// unauthenticated quota when the same user reopens the app several
// times in a session, short enough that growing star counts still
// surface within a single working day.
const CACHE_TTL_MS = 60 * 60 * 1000;
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000;

type CachedStars = { count: number; ts: number };

let memoryCache: CachedStars | null = null;
let memoryFailureAt: number | null = null;

function readPersistedCache(): CachedStars | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedStars>;
    if (typeof parsed.count !== 'number' || typeof parsed.ts !== 'number') {
      return null;
    }
    return { count: parsed.count, ts: parsed.ts };
  } catch {
    return null;
  }
}

function writePersistedCache(value: CachedStars): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(value));
  } catch {
    // Quota errors are fine to swallow — the in-memory cache still
    // keeps subsequent renders cheap within this tab.
  }
}

function readPersistedFailureAt(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(FAILURE_LS_KEY);
    if (!raw) return null;
    const ts = Number(raw);
    return Number.isFinite(ts) && ts > 0 ? ts : null;
  } catch {
    return null;
  }
}

function writePersistedFailureAt(ts: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FAILURE_LS_KEY, String(ts));
  } catch {
    // Same as the star cache: storage failures should not turn a
    // quiet offline badge into a renderer error source.
  }
}

function clearPersistedFailureAt(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(FAILURE_LS_KEY);
  } catch {
    // Ignore storage failures; the in-memory cooldown still covers
    // this renderer session.
  }
}

function rememberFetchFailure(): void {
  const failedAt = Date.now();
  memoryFailureAt = failedAt;
  writePersistedFailureAt(failedAt);
}

export function formatStars(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '0';
  if (count < 1000) return String(count);
  return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}K`;
}

export const GITHUB_REPO_URL = REPO;

export function useGithubStars(): number | null {
  const [count, setCount] = useState<number | null>(() => {
    const persisted = readPersistedCache();
    if (persisted) memoryCache = persisted;
    if (persisted) return persisted.count;
    if (typeof window === 'undefined' && memoryCache) return memoryCache.count;
    return null;
  });

  useEffect(() => {
    const now = Date.now();
    const cached = typeof window === 'undefined'
      ? memoryCache
      : readPersistedCache();
    if (cached && now - cached.ts < CACHE_TTL_MS) {
      memoryCache = cached;
      setCount(cached.count);
      return;
    }
    const failedAt = typeof window === 'undefined'
      ? memoryFailureAt
      : readPersistedFailureAt();
    if (failedAt && now - failedAt < FAILURE_COOLDOWN_MS) {
      memoryFailureAt = failedAt;
      return;
    }
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(API, {
          signal: ctrl.signal,
        });
        if (!res.ok) {
          rememberFetchFailure();
          return;
        }
        const data = (await res.json()) as Partial<OpenDocsGithubRepoResponse>;
        if (typeof data.stargazers_count !== 'number') {
          rememberFetchFailure();
          return;
        }
        const next: CachedStars = {
          count: data.stargazers_count,
          ts: Date.now(),
        };
        memoryCache = next;
        memoryFailureAt = null;
        writePersistedCache(next);
        clearPersistedFailureAt();
        setCount(next.count);
      } catch (error) {
        if (ctrl.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
          return;
        }
        // Network failures and rate-limit 403s both land here. The
        // caller keeps rendering its previous (or fallback) count.
        rememberFetchFailure();
      }
    })();
    return () => ctrl.abort();
  }, []);

  return count;
}
