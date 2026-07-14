'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { AnalyticsConfigureGlobals } from '@open-design/contracts/analytics';
import { randomUUID } from '../utils/uuid';

interface AnalyticsContextValue {
  track: (
    event: string,
    properties: Record<string, unknown>,
    options?: { requestId?: string; insertId?: string },
  ) => void;
  setConsent: (granted: boolean) => void;
  setIdentity: (installationId: string | null) => void;
  setConfigureGlobals: (next: AnalyticsConfigureGlobals) => void;
  setUserId: (userId: string | null) => void;
  anonymousId: string;
  sessionId: string;
  newRequestId: () => string;
}

const disabledAnalyticsValue: AnalyticsContextValue = {
  track: () => undefined,
  setConsent: () => undefined,
  setIdentity: () => undefined,
  setConfigureGlobals: () => undefined,
  setUserId: () => undefined,
  anonymousId: 'disabled',
  sessionId: 'disabled',
  newRequestId: () => randomUUID(),
};

const Ctx = createContext<AnalyticsContextValue>(disabledAnalyticsValue);

export function resolveAppVersionForCapture(current: string): Promise<string> {
  return Promise.resolve(current);
}

export function useAppVersion(): string {
  return '0.0.0';
}

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={disabledAnalyticsValue}>{children}</Ctx.Provider>;
}

export function useAnalytics(): AnalyticsContextValue {
  return useContext(Ctx);
}
