import { describe, expect, test } from 'vitest';

import {
  DEFAULT_PACKAGED_WIN_TEST_TIMEOUT_MS,
  resolvePackagedWinTestTimeoutMs,
} from '@/vitest/suite';

describe('packaged Windows test timeout', () => {
  test.each([
    undefined,
    '',
    '   ',
    'not-a-number',
    '900000ms',
    '719999',
    '-900000',
    '900000.5',
    '2147483648',
    '9007199254740992',
  ])('uses the 12-minute default for an absent or unsafe value: %s', (value) => {
    expect(resolvePackagedWinTestTimeoutMs(value)).toBe(DEFAULT_PACKAGED_WIN_TEST_TIMEOUT_MS);
  });

  test.each([
    ['720000', 720_000],
    [' 900000 ', 900_000],
    ['1800000', 1_800_000],
    ['2147483647', 2_147_483_647],
  ])('accepts a safe explicit local timeout: %s', (value, expected) => {
    expect(resolvePackagedWinTestTimeoutMs(value)).toBe(expected);
  });
});
