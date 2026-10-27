import { describe, expect, it } from 'vitest';

import { shouldAutoPreviewDesignArtifacts } from '../../../src/components/design-files/designArtifacts';

describe('shouldAutoPreviewDesignArtifacts', () => {
  it('previews the best design artifact when a design folder is imported', () => {
    expect(shouldAutoPreviewDesignArtifacts({ importedFrom: 'folder' })).toBe(true);
    expect(shouldAutoPreviewDesignArtifacts({ importedFrom: 'folder', workMode: 'creation' })).toBe(true);
  });

  // A development workspace can hold many independent projects. Picking the
  // newest/"best" HTML or image across all of them opens an arbitrary file from
  // a module the user is not working on and fills the side column with it.
  it('never previews an arbitrary workspace file in a development workspace', () => {
    expect(shouldAutoPreviewDesignArtifacts({ importedFrom: 'folder', workMode: 'development' })).toBe(false);
  });

  it('does not preview for projects that were not imported from a folder', () => {
    expect(shouldAutoPreviewDesignArtifacts({})).toBe(false);
    expect(shouldAutoPreviewDesignArtifacts({ importedFrom: 'claude-design' })).toBe(false);
    expect(shouldAutoPreviewDesignArtifacts(null)).toBe(false);
    expect(shouldAutoPreviewDesignArtifacts(undefined)).toBe(false);
  });
});
