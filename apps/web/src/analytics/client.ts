// Open Docs disables product telemetry in the browser. This module preserves
// the inherited analytics facade so UI code can keep calling `track`, but every
// operation is a no-op and no external analytics endpoint is loaded.

import type { AnalyticsConfigureGlobals } from '@open-design/contracts/analytics';
import { clearExceptionTrackingContext } from './error-tracking';

interface AnalyticsContext {
  anonymousId: string;
  sessionId: string;
  clientType: string;
  locale: string;
  appVersion: string;
}

interface AnalyticsClientLike {
  register(properties: Record<string, unknown>): void;
}

let resolvedDeviceId: string | null = null;
let configureGlobals: AnalyticsConfigureGlobals = {
  has_available_configure_cli: false,
  configure_type: 'unknown',
  configure_availability: 'unknown',
  runtime_type: 'none',
  cli_runnable: false,
  byok_runnable: false,
  amr_runnable: false,
};

export function getResolvedAnonymousId(): string | null {
  return resolvedDeviceId;
}

export function getResolvedDeviceId(): string | null {
  return resolvedDeviceId;
}

export function getConfigureGlobals(): AnalyticsConfigureGlobals {
  return configureGlobals;
}

export function setConfigureGlobals(next: AnalyticsConfigureGlobals): void {
  configureGlobals = { ...next };
}

export function setAnalyticsUserId(_userId: string | null): void {
  // No Open Docs telemetry identity is registered.
}

export async function bootstrapExceptionTracking(
  _context: AnalyticsContext,
): Promise<void> {
  clearExceptionTrackingContext();
}

export async function getAnalyticsClient(
  _context: AnalyticsContext,
): Promise<AnalyticsClientLike | null> {
  resolvedDeviceId = null;
  clearExceptionTrackingContext();
  return null;
}

export function applyConsent(_consentGranted: boolean): void {
  resolvedDeviceId = null;
  clearExceptionTrackingContext();
}

export function applyIdentity(_installationId: string | null): void {
  resolvedDeviceId = null;
}

export function capture(
  _client: AnalyticsClientLike | null,
  _args: {
    event: string;
    properties: Record<string, unknown>;
    insertId: string;
    requestId?: string | null;
  },
): void {
  // Intentionally empty: Open Docs does not send browser analytics.
}
