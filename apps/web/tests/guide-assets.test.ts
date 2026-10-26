import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// The Guide Center plays these files offline. They must keep their narration
// and stay under the 1 MiB changed-file limit CI enforces.
const guideDir = resolve(__dirname, '..', 'public', 'guide');

// An MP4 audio track announces itself with a sound-handler `hdlr` box.
function hasAudioTrack(mp4: Buffer): boolean {
  for (let at = mp4.indexOf('hdlr'); at !== -1; at = mp4.indexOf('hdlr', at + 4)) {
    if (mp4.toString('ascii', at + 12, at + 16) === 'soun') return true;
  }
  return false;
}

describe('Guide Center intro videos', () => {
  for (const language of ['ko', 'en']) {
    it(`${language} video is an MP4 with an audio track under 1 MiB`, () => {
      const video = readFileSync(resolve(guideDir, `monofield-intro-${language}.mp4`));
      expect(video.toString('ascii', 4, 8)).toBe('ftyp');
      expect(hasAudioTrack(video)).toBe(true);
      expect(video.byteLength).toBeLessThan(1_048_576);
    });
  }
});
