import type {
  AmrEntryAttribution,
  TrackingAmrEntrySource,
  TrackingPageName,
} from '@open-design/contracts/analytics';
import {
  readOnboardingProfile,
  type OnboardingProfile,
} from '../state/onboarding-profile';
import { trackAmrEntryClick } from './events';

type Track = (
  event: string,
  properties: Record<string, unknown>,
  options?: { requestId?: string; insertId?: string },
) => void;

interface RecordAmrEntryOptions {
  metricsConsent?: boolean;
  reuseExistingFrom?: readonly TrackingAmrEntrySource[];
}

interface SyncAmrProfileOptions {
  metricsConsent?: boolean;
  odDeviceId?: string | null;
  now?: Date;
}

const AMR_ATTRIBUTION_STORAGE_KEY = 'open-design:amr-entry-attribution:v1';
const AMR_ATTRIBUTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const ENTRY_PAGE_BY_SOURCE: Record<TrackingAmrEntrySource, TrackingPageName> = {
  onboarding_amr_card: 'onboarding',
  onboarding_amr_sign_in_continue: 'onboarding',
  inline_model_switcher_amr_row: 'chat_panel',
  settings_amr_agent_card: 'settings',
  settings_amr_authorize: 'settings',
  settings_amr_console: 'settings',
  settings_amr_install: 'settings',
  avatar_amr_console: 'chat_panel',
  handoff_amr_website: 'artifact',
  chat_error_authorize_retry: 'chat_panel',
  chat_error_recharge: 'chat_panel',
  chat_error_switch_retry_card: 'chat_panel',
  generation_preview_authorize_retry: 'file_manager',
  generation_preview_recharge: 'file_manager',
  generation_preview_switch_retry_card: 'file_manager',
};

const ONBOARDING_PROFILE_SYNC_SOURCES: readonly TrackingAmrEntrySource[] = [
  'onboarding_amr_card',
  'onboarding_amr_sign_in_continue',
];

export type { AmrEntryAttribution, TrackingAmrEntrySource };

// Where an amr_entry source surfaces in the product. amr-auth.ts reuses
// this to stamp `page_name` on amr_auth_result from the attribution alone.
export function amrEntryPageForSource(
  source: TrackingAmrEntrySource,
): TrackingPageName {
  return ENTRY_PAGE_BY_SOURCE[source];
}

export function recordAmrEntry(
  track: Track,
  sourceDetail: TrackingAmrEntrySource,
  now: Date = new Date(),
  options: RecordAmrEntryOptions = {},
): AmrEntryAttribution {
  const existing = readReusableAmrAttribution(now, options.reuseExistingFrom);
  if (existing) return existing;

  const profile = readOnboardingProfile();
  const attribution: AmrEntryAttribution = {
    entryId: `od-amr-${randomId()}`,
    sourceProduct: 'open_design',
    sourceDetail,
    occurredAt: now.toISOString(),
    ...(profile?.role ? { odRole: profile.role } : {}),
    ...(profile?.orgSize ? { odOrgSize: profile.orgSize } : {}),
    ...(profile?.useCase && profile.useCase.length > 0
      ? { odUseCase: profile.useCase }
      : {}),
    ...(profile?.source ? { odSource: profile.source } : {}),
  };
  writeAmrAttribution(attribution);
  trackAmrEntryClick(track, {
    page_name: ENTRY_PAGE_BY_SOURCE[sourceDetail],
    area: 'amr_entry',
    element: sourceDetail,
    action: 'click_amr_entry',
    entry_id: attribution.entryId,
    source_product: attribution.sourceProduct,
    source_detail: attribution.sourceDetail,
    entry_occurred_at: attribution.occurredAt,
  });
  if (options.metricsConsent === true) {
    void mirrorAmrEntryToAmrAnalytics(attribution);
  }
  return attribution;
}

export function readAmrAttribution(now: Date = new Date()): AmrEntryAttribution | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(AMR_ATTRIBUTION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AmrEntryAttribution>;
    if (!isValidAmrAttribution(parsed)) return null;
    if (now.getTime() - Date.parse(parsed.occurredAt) > AMR_ATTRIBUTION_TTL_MS) {
      window.localStorage.removeItem(AMR_ATTRIBUTION_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function syncAmrAttributionWithOnboardingProfile(
  profile: OnboardingProfile,
  options: SyncAmrProfileOptions = {},
): AmrEntryAttribution | null {
  const now = options.now ?? new Date();
  const existing = readAmrAttribution(now);
  if (!existing) return null;
  if (!ONBOARDING_PROFILE_SYNC_SOURCES.includes(existing.sourceDetail)) {
    return null;
  }
  const fields = amrProfileFields(profile);
  if (!fields) return null;
  const next: AmrEntryAttribution = {
    ...existing,
    ...fields,
    ...(options.odDeviceId
      ? { odDeviceId: options.odDeviceId }
      : existing.odDeviceId
        ? { odDeviceId: existing.odDeviceId }
        : {}),
  };
  writeAmrAttribution(next);
  if (options.metricsConsent === true) {
    void mirrorAmrOnboardingProfileToAmrAnalytics(next, now);
  }
  return next;
}

// MonoField does not mirror AMR attribution into product telemetry. This helper
// therefore returns null unless a later AMR task introduces an explicit,
// user-approved handoff identifier.
export function amrHandoffDeviceId(input: {
  metricsConsent: boolean;
  resolvedDeviceId: string | null;
  installationId: string | null | undefined;
}): string | null {
  void input;
  return null;
}

// Builds the AMR handoff URL with non-identifying entry context only.
export function attributedAmrUrl(
  baseUrl: string,
  attribution: AmrEntryAttribution,
  deviceId?: string | null,
): string {
  const params: Record<string, string> = {
    od_origin: attribution.sourceProduct,
    od_entry_id: attribution.entryId,
    od_entry_source: attribution.sourceDetail,
    od_entry_at: attribution.occurredAt,
  };
  if (deviceId) params.od_device_id = deviceId;
  try {
    const url = new URL(baseUrl);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  } catch {
    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}${new URLSearchParams(params).toString()}`;
  }
}

function writeAmrAttribution(attribution: AmrEntryAttribution): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AMR_ATTRIBUTION_STORAGE_KEY, JSON.stringify(attribution));
  } catch {
    // Analytics persistence must never block the primary action.
  }
}

function amrProfileFields(
  profile: OnboardingProfile,
): Pick<
  AmrEntryAttribution,
  'odRole' | 'odOrgSize' | 'odUseCase' | 'odSource'
> | null {
  const role = cleanProfileValue(profile.role);
  const orgSize = cleanProfileValue(profile.orgSize);
  const source = cleanProfileValue(profile.source);
  const useCase = Array.isArray(profile.useCase)
    ? profile.useCase
        .map(cleanProfileValue)
        .filter((value): value is string => Boolean(value))
    : [];
  if (!role && !orgSize && useCase.length === 0 && !source) return null;
  return {
    ...(role ? { odRole: role } : {}),
    ...(orgSize ? { odOrgSize: orgSize } : {}),
    ...(useCase.length > 0 ? { odUseCase: useCase } : {}),
    ...(source ? { odSource: source } : {}),
  };
}

function cleanProfileValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'unknown') return null;
  return trimmed;
}

function readReusableAmrAttribution(
  now: Date,
  reuseExistingFrom: readonly TrackingAmrEntrySource[] | undefined,
): AmrEntryAttribution | null {
  if (!reuseExistingFrom || reuseExistingFrom.length === 0) return null;
  const existing = readAmrAttribution(now);
  if (!existing) return null;
  return reuseExistingFrom.includes(existing.sourceDetail) ? existing : null;
}

async function mirrorAmrEntryToAmrAnalytics(
  _attribution: AmrEntryAttribution,
): Promise<void> {
  // MonoField does not mirror AMR analytics in the MVP.
}
async function mirrorAmrOnboardingProfileToAmrAnalytics(
  _attribution: AmrEntryAttribution,
  _now: Date,
): Promise<void> {
  // MonoField does not mirror AMR analytics in the MVP.
}
function isValidAmrAttribution(value: Partial<AmrEntryAttribution>): value is AmrEntryAttribution {
  return value.sourceProduct === 'open_design'
    && typeof value.entryId === 'string'
    && value.entryId.length > 0
    && typeof value.sourceDetail === 'string'
    && value.sourceDetail in ENTRY_PAGE_BY_SOURCE
    && typeof value.occurredAt === 'string'
    && Number.isFinite(Date.parse(value.occurredAt));
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
