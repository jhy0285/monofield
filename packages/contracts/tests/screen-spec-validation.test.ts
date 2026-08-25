import { describe, expect, it } from 'vitest';
import { parseScreenSpecDocument, SCREEN_SPEC_SCHEMA_VERSION } from '../src/docs/screen-spec';

describe('screen-spec validation', () => {
  it('blocks an empty screen document', () => {
    const parsed = parseScreenSpecDocument({
      schemaVersion: SCREEN_SPEC_SCHEMA_VERSION,
      kind: 'screen-spec',
      name: 'Empty',
      screens: [],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.issues).toContainEqual(expect.objectContaining({ code: 'missing-screen', severity: 'fatal' }));
  });

  it('detects non-sequential markers and incomplete review rows', () => {
    const parsed = parseScreenSpecDocument({
      schemaVersion: SCREEN_SPEC_SCHEMA_VERSION,
      kind: 'screen-spec',
      name: 'Order UI',
      screens: [{
        id: 'SCR-001',
        screenName: '',
        callouts: [{ no: 2, label: 'Button', description: '', position: { x: 0.5, y: 0.5 } }],
        checkpoints: [''],
      }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'non-sequential-callout-no', severity: 'fatal' }),
      expect.objectContaining({ code: 'missing-screen-name', severity: 'warning' }),
      expect.objectContaining({ code: 'empty-callout-description', severity: 'warning' }),
      expect.objectContaining({ code: 'empty-checkpoint', severity: 'warning' }),
    ]));
  });
});
