import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  credentialVaultKey,
  credentialVaultKeyCandidates,
  legacyCredentialVaultKey,
} from '../src/credential-vault.js';

describe('credential vault keys', () => {
  const mixedCaseScope = path.join(path.parse(process.cwd()).root, 'MonoField', 'Workspace', 'Project');
  const lowerCaseScope = mixedCaseScope.toLowerCase();

  it('preserves scope-path case with a case-sensitive strategy', () => {
    expect(credentialVaultKey('media', mixedCaseScope, 'openai', { caseInsensitiveScope: false }))
      .not.toBe(credentialVaultKey('media', lowerCaseScope, 'openai', { caseInsensitiveScope: false }));
  });

  it('folds scope-path case with a case-insensitive strategy', () => {
    expect(credentialVaultKey('media', mixedCaseScope, 'openai', { caseInsensitiveScope: true }))
      .toBe(credentialVaultKey('media', lowerCaseScope, 'openai', { caseInsensitiveScope: true }));
  });

  it('exposes the historical lower-cased key as a compatibility candidate', () => {
    const current = credentialVaultKey('media', mixedCaseScope, 'openai');
    const legacy = legacyCredentialVaultKey('media', mixedCaseScope, 'openai');
    const candidates = credentialVaultKeyCandidates('media', mixedCaseScope, 'openai');

    expect(candidates[0]).toBe(current);
    expect(candidates).toContain(legacy);
    expect(new Set(candidates).size).toBe(candidates.length);
    expect(candidates).toHaveLength(process.platform === 'win32' ? 1 : 2);
  });
});
