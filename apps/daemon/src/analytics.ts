// MonoField disables product telemetry at the daemon boundary. The inherited
// analytics API surface remains so callers do not need feature flags, but every
// service returned here is a no-op and no external endpoint is contacted.

import crypto from 'node:crypto';
import type { Request } from 'express';
import {
  ANALYTICS_HEADER_DEVICE_ID,
  ANALYTICS_HEADER_CLIENT_TYPE,
  ANALYTICS_HEADER_LOCALE,
  ANALYTICS_HEADER_REQUEST_ID,
  ANALYTICS_HEADER_SESSION_ID,
  anonymizeArtifactId as anonymizeArtifactIdShared,
  type AnalyticsClientType,
  type AnalyticsConfigResponse,
} from '@open-design/contracts/analytics';
import { readTelemetryEnvironment } from './telemetry-environment.js';

export interface AnalyticsContext {
  deviceId: string;
  sessionId: string;
  clientType: AnalyticsClientType;
  locale: string;
  requestId: string | null;
}

// Keep parsing helpers available for callers, but no telemetry headers are
// installed by MonoField because /api/analytics/config never exposes a sink.
export function readAnalyticsContext(req: Request): AnalyticsContext | null {
  const deviceId = headerString(req, ANALYTICS_HEADER_DEVICE_ID);
  if (!deviceId) return null;
  const sessionId = headerString(req, ANALYTICS_HEADER_SESSION_ID) ?? deviceId;
  const clientHeader = headerString(req, ANALYTICS_HEADER_CLIENT_TYPE);
  const clientType: AnalyticsClientType =
    clientHeader === 'desktop' ? 'desktop' : 'web';
  const locale = headerString(req, ANALYTICS_HEADER_LOCALE) ?? 'en';
  const requestId = headerString(req, ANALYTICS_HEADER_REQUEST_ID);
  return { deviceId, sessionId, clientType, locale, requestId };
}

function headerString(req: Request, name: string): string | null {
  const raw = req.headers[name];
  if (Array.isArray(raw)) return raw[0]?.trim() || null;
  if (typeof raw === 'string') return raw.trim() || null;
  return null;
}

export interface PosthogConfig {
  key: string;
  host: string;
  env: string;
}

export function readPosthogConfig(
  _env: NodeJS.ProcessEnv = process.env,
): PosthogConfig | null {
  return null;
}

export function readPublicConfigResponse(
  env: NodeJS.ProcessEnv = process.env,
): AnalyticsConfigResponse {
  return {
    enabled: false,
    env: readTelemetryEnvironment(env),
    key: null,
    host: null,
  };
}

export interface AnalyticsService {
  capture(args: {
    eventName: string;
    context: AnalyticsContext;
    appVersion: string;
    properties: Record<string, unknown>;
    insertId: string;
  }): void;
  captureSafety(args: {
    eventName: string;
    distinctId?: string;
    appVersion: string;
    properties: Record<string, unknown>;
    insertId?: string;
  }): Promise<void>;
  shutdown(): Promise<void>;
}

const NOOP_SERVICE: AnalyticsService = {
  capture: () => undefined,
  captureSafety: async () => undefined,
  shutdown: async () => undefined,
};

export function createAnalyticsService(_args: {
  env?: NodeJS.ProcessEnv;
  dataDir: string;
}): AnalyticsService {
  return NOOP_SERVICE;
}

// Re-export so server.ts and route handlers do not need a second import path;
// the canonical hash lives in @open-design/contracts/analytics.
export const anonymizeArtifactId = anonymizeArtifactIdShared;

export function newInsertId(): string {
  return crypto.randomUUID();
}
