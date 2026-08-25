// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';

import { PrivacySection } from '../../src/components/PrivacySection';
import { I18nProvider } from '../../src/i18n';
import type { AppConfig } from '../../src/types';

const baseConfig: AppConfig = {
  mode: 'api',
  apiKey: '',
  apiProtocol: 'anthropic',
  apiVersion: '',
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-sonnet-4-5',
  apiProviderBaseUrl: 'https://api.anthropic.com',
  apiProtocolConfigs: {},
  agentId: null,
  skillId: null,
  designSystemId: null,
  onboardingCompleted: true,
  mediaProviders: {},
  agentModels: {},
  agentCliEnv: {},
};

function Harness({ initial }: { initial: AppConfig }) {
  const [cfg, setCfg] = useState(initial);
  return (
    <I18nProvider initial="en">
      <PrivacySection cfg={cfg} setCfg={setCfg} />
    </I18nProvider>
  );
}

describe('PrivacySection', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('keeps MonoField telemetry disabled and clears legacy local privacy state', () => {
    render(
      <Harness
        initial={{
          ...baseConfig,
          installationId: 'legacy-inst',
          privacyDecisionAt: 1778244000000,
          telemetry: { metrics: true, content: true, artifactManifest: true },
        }}
      />,
    );

    expect(screen.getByText(/MonoField does not send product telemetry/i)).toBeTruthy();
    expect((screen.getByLabelText('Anonymous ID') as HTMLInputElement).value).toBe(
      'legacy-inst',
    );
    expect(screen.queryByRole('button', { name: /Anonymous metrics/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Clear local privacy state/i }));

    expect((screen.getByLabelText('Anonymous ID') as HTMLInputElement).value).toBe(
      'not used',
    );
  });
});
