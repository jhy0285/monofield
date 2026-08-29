// @vitest-environment jsdom

import { STORED_BYOK_API_KEY } from '@open-design/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ByokKeyField } from '../../src/components/byok/ByokKeyField';

const labels = {
  apiHint: 'Stored securely on this device',
  apiKeyCleaned: 'Cleaned',
  clear: 'Clear',
  apiKey: 'API key',
  apiKeyGetLink: 'Get a key',
  apiKeyInvalid: 'Invalid key',
  hide: 'Hide',
  hideKey: 'Hide API key',
  required: 'Required',
  show: 'Show',
  showKey: 'Show API key',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ByokKeyField', () => {
  it('renders a stored credential as a non-recoverable mask and clears it explicitly', () => {
    const onChange = vi.fn();
    const { container } = render(
      <ByokKeyField
        apiKey={STORED_BYOK_API_KEY}
        apiKeyConsoleLink={{ host: 'console.example.test', url: 'https://console.example.test' }}
        apiProtocol="anthropic"
        inputRef={null}
        labels={labels}
        requiresApiKey
        showApiKeyInvalid={false}
        showApiKey={false}
        onBlur={vi.fn()}
        onChange={onChange}
        onFocus={vi.fn()}
        onToggleShowApiKey={vi.fn()}
      />,
    );

    const input = screen.getByLabelText(labels.apiKey) as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('••••••••');
    expect(container.textContent).not.toContain(STORED_BYOK_API_KEY);

    fireEvent.click(screen.getByRole('button', { name: labels.clear }));
    expect(onChange).toHaveBeenCalledWith('');
  });
});
