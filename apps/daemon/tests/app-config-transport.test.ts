import { describe, expect, it } from 'vitest';
import {
  compactAppConfigForTransport,
  decodePetImageDataUrl,
  restoreHostedPetImageInPatch,
} from '../src/routes/media.js';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

describe('app-config pet image transport', () => {
  const config = {
    pet: {
      adopted: true,
      enabled: true,
      petId: 'custom',
      custom: {
        name: 'Tux',
        glyph: 'T',
        accent: '#000000',
        greeting: 'Hello',
        imageUrl: PNG_DATA_URL,
      },
    },
  };

  it('replaces embedded pet base64 with a lazy same-origin image route', () => {
    const compact = compactAppConfigForTransport(config);

    expect(compact.pet?.custom.imageUrl).toBe('/api/app-config/pet-image');
    expect(JSON.stringify(compact)).not.toContain('base64');
    expect(config.pet.custom.imageUrl).toBe(PNG_DATA_URL);
  });

  it('preserves the stored image when a compact config is written back', () => {
    const restored = restoreHostedPetImageInPatch({
      pet: {
        ...config.pet,
        custom: {
          ...config.pet.custom,
          imageUrl: '/api/app-config/pet-image',
          greeting: 'Updated',
        },
      },
    }, config);

    expect((restored.pet as typeof config.pet).custom).toMatchObject({
      imageUrl: PNG_DATA_URL,
      greeting: 'Updated',
    });
  });

  it('decodes only bounded image MIME data URLs for the image response', () => {
    expect(decodePetImageDataUrl(PNG_DATA_URL)).toMatchObject({
      mimeType: 'image/png',
    });
    expect(decodePetImageDataUrl('data:text/html;base64,PGgxPng8L2gxPg==')).toBeNull();
    expect(decodePetImageDataUrl('https://example.com/pet.png')).toBeNull();
  });

  it('never includes Local CLI credential material in app-config transport', () => {
    const secret = 'sk-cli-transport-must-not-leak';
    const compact = compactAppConfigForTransport({
      agentCliEnv: {
        claude: {
          CLAUDE_CONFIG_DIR: '~/.claude',
          ANTHROPIC_API_KEY: secret,
        },
      },
    });

    expect(JSON.stringify(compact)).not.toContain(secret);
    expect(compact.agentCliEnv).toEqual({
      claude: {
        CLAUDE_CONFIG_DIR: '~/.claude',
        ANTHROPIC_API_KEY: '__MONOFIELD_STORED_CLI_CREDENTIAL__',
      },
    });
  });
});
