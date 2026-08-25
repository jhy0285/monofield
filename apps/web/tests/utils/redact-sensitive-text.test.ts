import { describe, expect, it } from 'vitest';

import { redactSensitiveText } from '../../src/utils/redactSensitiveText';

describe('redactSensitiveText', () => {
  it('masks YAML, JSON, shell, and credential URL values', () => {
    const redacted = redactSensitiveText([
      'password: local-secret',
      '"client_secret": "oauth-secret"',
      'API_KEY=provider-secret',
      'jdbc:postgresql://app:db-secret@localhost:5432/sample',
    ].join('\n'));

    expect(redacted).toContain('password: [REDACTED]');
    expect(redacted).toContain('"client_secret": "[REDACTED]"');
    expect(redacted).toContain('API_KEY=[REDACTED]');
    expect(redacted).toContain('postgresql://app:[REDACTED]@localhost');
    expect(redacted).not.toContain('local-secret');
    expect(redacted).not.toContain('oauth-secret');
    expect(redacted).not.toContain('provider-secret');
    expect(redacted).not.toContain('db-secret');
  });

  it('keeps environment references and ordinary code readable', () => {
    const source = [
      'password: ${DB_PASSWORD}',
      'secret = env(APP_SECRET)',
      'server.port=9081',
      'const tokenCount = 42;',
    ].join('\n');

    expect(redactSensitiveText(source)).toBe(source);
  });
});
