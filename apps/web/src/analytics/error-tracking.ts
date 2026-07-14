// Open Docs does not send browser exception, safety, or reliability telemetry.
// The inherited observability call sites remain wired to this facade, but the
// facade is intentionally inert.

import { scrubFilePath } from './scrub';

interface ExceptionTrackingContext {
  apiKey: string;
  host: string;
  distinctId: string;
  appVersion?: string;
  sessionId?: string;
  telemetryEnv?: string;
}

export function setExceptionTrackingContext(
  _next: ExceptionTrackingContext,
): void {
  // No external telemetry context is retained.
}

export function clearExceptionTrackingContext(): void {
  // No external telemetry context is retained.
}

export function patchExceptionTrackingAppVersion(_version: string): void {
  // No-op.
}

export function installErrorHandlers(): void {
  // No-op: Open Docs does not install telemetry-oriented global error hooks.
}

export function reportHandledException(
  _error: unknown,
  _message?: string,
): void {
  // No-op.
}

export function reportSafetyEvent(
  _eventName: string,
  _properties: Record<string, unknown> = {},
): void {
  // No-op.
}

export { scrubFilePath };
