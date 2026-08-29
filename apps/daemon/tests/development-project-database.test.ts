import { describe, expect, it } from 'vitest';

import {
  activeDevelopmentDatabaseContext,
  metadataWithActiveDevelopmentDatabaseContext,
} from '../src/development-projects.js';

describe('development module database isolation', () => {
  it('keeps the legacy project binding compatible before a module map exists', () => {
    expect(activeDevelopmentDatabaseContext({
      kind: 'other',
      workMode: 'development',
      development: { activeProjectPath: 'service-a' },
      databaseContext: { connectionId: 'db-a', label: 'A', useForDevelopment: true },
    })).toEqual({ connectionId: 'db-a', label: 'A', useForDevelopment: true });
  });

  it('resolves a separate database for each active module', () => {
    const base = {
      kind: 'other' as const,
      workMode: 'development' as const,
      development: {
        activeProjectPath: 'service-a',
        databaseContextsByProject: {
          'service-a': { connectionId: 'db-a', useForDevelopment: true },
          'service-b': { connectionId: 'db-b', useForDevelopment: true },
        },
      },
    };

    expect(activeDevelopmentDatabaseContext(base)?.connectionId).toBe('db-a');
    expect(activeDevelopmentDatabaseContext({
      ...base,
      development: { ...base.development, activeProjectPath: 'service-b' },
    })?.connectionId).toBe('db-b');
  });

  it('never inherits a sibling binding from the legacy field once the module map exists', () => {
    const metadata = {
      kind: 'other' as const,
      workMode: 'development' as const,
      databaseContext: { connectionId: 'db-a', useForDevelopment: true },
      development: {
        activeProjectPath: 'service-b',
        databaseContextsByProject: {
          'service-a': { connectionId: 'db-a', useForDevelopment: true },
        },
      },
    };

    expect(activeDevelopmentDatabaseContext(metadata)).toBeNull();
    expect(metadataWithActiveDevelopmentDatabaseContext(metadata)).not.toHaveProperty('databaseContext');
  });

  it('fails closed for an invalid stored module path', () => {
    expect(activeDevelopmentDatabaseContext({
      kind: 'other',
      workMode: 'development',
      databaseContext: { connectionId: 'db-a', useForDevelopment: true },
      development: {
        activeProjectPath: '../service-a',
        databaseContextsByProject: {
          'service-a': { connectionId: 'db-a', useForDevelopment: true },
        },
      },
    })).toBeNull();
  });
});
