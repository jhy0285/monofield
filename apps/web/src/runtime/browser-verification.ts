import type { OpenDesignHostBrowserAutomationSession } from '@open-design/host';

export type ActiveBrowserVerification = {
  origin: string;
  sessionId: string;
  url: string;
};

const activeByProject = new Map<string, Map<string, ActiveBrowserVerification>>();
const listeners = new Set<(projectId: string) => void>();

function emit(projectId: string): void {
  for (const listener of listeners) listener(projectId);
}

export function setActiveBrowserVerification(
  projectId: string,
  session: OpenDesignHostBrowserAutomationSession,
  url: string,
): void {
  if (!projectId || !session.sessionId || !url) return;
  const sessions = activeByProject.get(projectId) ?? new Map<string, ActiveBrowserVerification>();
  sessions.delete(session.sessionId);
  sessions.set(session.sessionId, {
    origin: session.origin,
    sessionId: session.sessionId,
    url,
  });
  activeByProject.set(projectId, sessions);
  emit(projectId);
}

export function clearActiveBrowserVerification(projectId: string, sessionId?: string): void {
  const sessions = activeByProject.get(projectId);
  if (!sessions) return;
  const changed = sessionId ? sessions.delete(sessionId) : sessions.size > 0;
  if (!sessionId) sessions.clear();
  if (!changed) return;
  if (sessions.size === 0) activeByProject.delete(projectId);
  emit(projectId);
}

export function subscribeActiveBrowserVerification(listener: (projectId: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getActiveBrowserVerification(projectId: string): ActiveBrowserVerification | undefined {
  const sessions = activeByProject.get(projectId);
  const current = sessions ? [...sessions.values()].at(-1) : undefined;
  return current ? { ...current } : undefined;
}
