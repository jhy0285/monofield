// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  amrHandoffDeviceId,
  attributedAmrUrl,
  readAmrAttribution,
  recordAmrEntry,
  syncAmrAttributionWithOnboardingProfile,
} from '../../src/analytics/amr-attribution';
import { saveOnboardingProfile } from '../../src/state/onboarding-profile';

// MonoField keeps AMR entry attribution on the device and never mirrors it to an
// analytics endpoint, so these tests pin the local record, the entry id reuse and
// the URL building, and that nothing is sent even when metrics consent is on.
describe('AMR attribution helper', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.localStorage.clear();
    fetchMock = vi.fn(async () => new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts every AMR entry source defined for Open Design entry points', () => {
    const track = vi.fn();
    const sources = [
      'onboarding_amr_card',
      'onboarding_amr_sign_in_continue',
      'inline_model_switcher_amr_row',
      'settings_amr_agent_card',
      'settings_amr_authorize',
      'settings_amr_console',
      'settings_amr_install',
      'avatar_amr_console',
      'handoff_amr_website',
      'chat_error_authorize_retry',
      'chat_error_recharge',
      'chat_error_switch_retry_card',
      'generation_preview_authorize_retry',
      'generation_preview_recharge',
      'generation_preview_switch_retry_card',
    ] as const;

    for (const [index, source] of sources.entries()) {
      recordAmrEntry(
        track,
        source,
        new Date(`2026-06-03T12:00:${index.toString().padStart(2, '0')}.000Z`),
        { metricsConsent: true },
      );
    }

    expect(track).toHaveBeenCalledTimes(sources.length);
    expect(track.mock.calls.map(([, props]) => props.element)).toEqual(sources);
  });

  it('records a last-touch AMR entry and emits the matching ui_click event', () => {
    const track = vi.fn();
    const now = new Date('2026-06-03T12:00:00.000Z');

    const attribution = recordAmrEntry(track, 'chat_error_recharge', now, {
      metricsConsent: true,
    });

    expect(attribution).toMatchObject({
      sourceProduct: 'open_design',
      sourceDetail: 'chat_error_recharge',
      occurredAt: '2026-06-03T12:00:00.000Z',
    });
    expect(attribution.entryId).toMatch(/^od-amr-/u);
    expect(readAmrAttribution(now)).toEqual(attribution);
    expect(track).toHaveBeenCalledWith(
      'ui_click',
      expect.objectContaining({
        page_name: 'chat_panel',
        area: 'amr_entry',
        element: 'chat_error_recharge',
        action: 'click_amr_entry',
        entry_id: attribution.entryId,
        source_product: 'open_design',
        source_detail: 'chat_error_recharge',
        entry_occurred_at: '2026-06-03T12:00:00.000Z',
      }),
      undefined,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('attaches the persisted onboarding profile to the local entry only', () => {
    saveOnboardingProfile({
      role: 'pm',
      orgSize: 'startup',
      useCase: ['product', 'design-system'],
      source: 'github',
    });
    const track = vi.fn();
    const now = new Date('2026-06-03T12:00:00.000Z');

    const attribution = recordAmrEntry(track, 'chat_error_recharge', now, {
      metricsConsent: true,
    });

    expect(attribution).toMatchObject({
      odRole: 'pm',
      odOrgSize: 'startup',
      odUseCase: ['product', 'design-system'],
      odSource: 'github',
    });
    expect(readAmrAttribution(now)).toEqual(attribution);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('omits profile fields entirely when no onboarding profile is stored', () => {
    const track = vi.fn();
    const attribution = recordAmrEntry(
      track,
      'chat_error_recharge',
      new Date('2026-06-03T12:00:00.000Z'),
      { metricsConsent: true },
    );

    expect(attribution.odRole).toBeUndefined();
    expect(attribution.odOrgSize).toBeUndefined();
    expect(attribution).not.toHaveProperty('odRole');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reuses a previous entry id for follow-up actions in the same source path', () => {
    const track = vi.fn();
    const first = recordAmrEntry(
      track,
      'onboarding_amr_card',
      new Date('2026-06-03T12:00:00.000Z'),
      { metricsConsent: true },
    );

    const second = recordAmrEntry(
      track,
      'onboarding_amr_sign_in_continue',
      new Date('2026-06-03T12:00:05.000Z'),
      { reuseExistingFrom: ['onboarding_amr_card'] },
    );

    expect(second).toEqual(first);
    expect(track).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(readAmrAttribution(new Date('2026-06-03T12:00:05.000Z'))).toEqual(
      first,
    );
  });

  it('syncs an existing AMR entry with onboarding profile after About you is submitted', () => {
    const track = vi.fn();
    const entryTime = new Date('2026-06-03T12:00:00.000Z');
    const profileTime = new Date('2026-06-03T12:03:00.000Z');
    const attribution = recordAmrEntry(track, 'onboarding_amr_card', entryTime);
    fetchMock.mockClear();

    const updated = syncAmrAttributionWithOnboardingProfile(
      {
        role: 'pm',
        orgSize: 'startup',
        useCase: ['product', 'design-system'],
        source: 'github',
      },
      {
        metricsConsent: true,
        odDeviceId: 'od-install-abc',
        now: profileTime,
      },
    );

    expect(updated).toMatchObject({
      entryId: attribution.entryId,
      sourceDetail: 'onboarding_amr_card',
      odDeviceId: 'od-install-abc',
      odRole: 'pm',
      odOrgSize: 'startup',
      odUseCase: ['product', 'design-system'],
      odSource: 'github',
    });
    expect(readAmrAttribution(profileTime)).toEqual(updated);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not mirror AMR entry analytics without metrics consent', () => {
    const track = vi.fn();
    const now = new Date('2026-06-03T12:00:00.000Z');

    const attribution = recordAmrEntry(track, 'chat_error_recharge', now);

    expect(attribution).toMatchObject({
      sourceProduct: 'open_design',
      sourceDetail: 'chat_error_recharge',
      occurredAt: '2026-06-03T12:00:00.000Z',
    });
    expect(readAmrAttribution(now)).toEqual(attribution);
    expect(track).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not mirror AMR onboarding profile analytics without metrics consent', () => {
    const track = vi.fn();
    const entryTime = new Date('2026-06-03T12:00:00.000Z');
    const profileTime = new Date('2026-06-03T12:03:00.000Z');
    const attribution = recordAmrEntry(track, 'onboarding_amr_card', entryTime);
    fetchMock.mockClear();

    const updated = syncAmrAttributionWithOnboardingProfile(
      {
        role: 'pm',
        orgSize: 'startup',
        useCase: ['product', 'design-system'],
        source: 'github',
      },
      { odDeviceId: null, now: profileTime },
    );

    expect(updated).toMatchObject({
      entryId: attribution.entryId,
      sourceDetail: 'onboarding_amr_card',
      odRole: 'pm',
      odOrgSize: 'startup',
      odUseCase: ['product', 'design-system'],
      odSource: 'github',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    'settings_amr_console',
    'avatar_amr_console',
    'handoff_amr_website',
  ] as const)(
    'ignores %s attribution when About you is submitted later',
    (sourceDetail) => {
      const track = vi.fn();
      const entryTime = new Date('2026-06-03T12:00:00.000Z');
      const profileTime = new Date('2026-06-03T12:03:00.000Z');
      const attribution = recordAmrEntry(track, sourceDetail, entryTime, {
        metricsConsent: true,
      });
      fetchMock.mockClear();

      const updated = syncAmrAttributionWithOnboardingProfile(
        {
          role: 'pm',
          orgSize: 'startup',
          useCase: ['product', 'design-system'],
          source: 'github',
        },
        {
          metricsConsent: true,
          odDeviceId: 'od-install-abc',
          now: profileTime,
        },
      );

      expect(updated).toBeNull();
      expect(readAmrAttribution(profileTime)).toEqual(attribution);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('expires stored attribution after seven days', () => {
    const track = vi.fn();
    const attribution = recordAmrEntry(
      track,
      'settings_amr_authorize',
      new Date('2026-06-03T12:00:00.000Z'),
    );

    expect(readAmrAttribution(new Date('2026-06-10T11:59:59.000Z'))).toEqual(
      attribution,
    );
    expect(readAmrAttribution(new Date('2026-06-10T12:00:01.000Z'))).toBeNull();
  });

  it('adds Open Design attribution params to AMR wallet URLs', () => {
    expect(
      attributedAmrUrl('https://open-design.ai/amr/wallet?tab=recharge', {
        entryId: 'od-amr-entry-123',
        sourceProduct: 'open_design',
        sourceDetail: 'generation_preview_recharge',
        occurredAt: '2026-06-03T12:00:00.000Z',
      }),
    ).toBe(
      'https://open-design.ai/amr/wallet?tab=recharge&od_origin=open_design&od_entry_id=od-amr-entry-123&od_entry_source=generation_preview_recharge&od_entry_at=2026-06-03T12%3A00%3A00.000Z',
    );
  });

  it('adds od_device_id only when a device id is provided', () => {
    const attribution = {
      entryId: 'od-amr-entry-123',
      sourceProduct: 'open_design' as const,
      sourceDetail: 'generation_preview_recharge' as const,
      occurredAt: '2026-06-03T12:00:00.000Z',
    };
    // With a device id (user opted into metrics): od_device_id is present.
    expect(
      attributedAmrUrl('https://open-design.ai/amr/wallet', attribution, 'od-install-abc'),
    ).toContain('od_device_id=od-install-abc');
    // Without one (consent off): no od_device_id param leaks into the URL.
    expect(
      attributedAmrUrl('https://open-design.ai/amr/wallet', attribution, null),
    ).not.toContain('od_device_id');
  });

  it('never forwards a device id in the AMR handoff, with or without consent', () => {
    for (const metricsConsent of [false, true]) {
      expect(
        amrHandoffDeviceId({
          metricsConsent,
          resolvedDeviceId: 'od-install-abc',
          installationId: 'od-install-abc',
        }),
      ).toBeNull();
      expect(
        amrHandoffDeviceId({
          metricsConsent,
          resolvedDeviceId: null,
          installationId: 'config-install-xyz',
        }),
      ).toBeNull();
    }
  });

  it('does not let a rotated installation id reach the handoff either', () => {
    expect(
      amrHandoffDeviceId({
        metricsConsent: true,
        resolvedDeviceId: 'od-install-OLD',
        installationId: 'od-install-NEW',
      }),
    ).toBeNull();
  });
});
