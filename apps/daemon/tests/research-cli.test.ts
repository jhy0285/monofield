import { describe, expect, it } from 'vitest';

import {
  researchSearchEndpoint,
  researchSearchHeaders,
  splitResearchSubcommand,
} from '../src/research/cli-args.js';

describe('research CLI', () => {
  it('preserves query values equal to the search subcommand', () => {
    expect(
      splitResearchSubcommand([
        'search',
        '--query',
        'search',
        '--daemon-url',
        'http://127.0.0.1:7456',
      ]),
    ).toEqual({
      sub: 'search',
      subArgs: ['--query', 'search', '--daemon-url', 'http://127.0.0.1:7456'],
    });
  });

  it('uses the run-scoped research endpoint and bearer token inside agent runs', () => {
    expect(researchSearchEndpoint(' odtt_secret ')).toBe('/api/tools/research/search');
    expect(researchSearchHeaders(' odtt_secret ')).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer odtt_secret',
    });
  });

  it('keeps the local UI/standalone CLI endpoint when no run token exists', () => {
    expect(researchSearchEndpoint(undefined)).toBe('/api/research/search');
    expect(researchSearchHeaders(undefined)).toEqual({
      'content-type': 'application/json',
    });
  });
});
