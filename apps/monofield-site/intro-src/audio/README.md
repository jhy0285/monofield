# Intro audio

`intro-ko.m4a` and `intro-en.m4a` are the sound for the 30-second intro. They are
the source of truth for the audio: `e2e/scripts/render-intro-video.ts` muxes them
into `intro/monofield-intro-<lang>.mp4` (and the in-app copy in
`apps/web/public/guide`) without re-encoding. Delete a file here to render that
language silent again.

Each track is stereo AAC at 64 kbps, 30.0 s, normalised to about -16 LUFS, so a
video stays under the 1 MiB changed-file limit CI enforces.

## What is in them

- **Narration** is synthesized speech, not a recording of a person. The scenes in
  `scene.html` set the timing (a line starts with its scene).
- **Music bed** is original and synthesized for this video (a soft pad, a bass note
  and sparse bell plucks on a four-chord loop at 92 BPM). It uses no third-party
  recording, sample or library, so there is nothing to license or attribute.
- The bed ducks under the voice with a sidechain compressor.

| Language | Voice | Model | License |
| --- | --- | --- | --- |
| Korean | MeloTTS Korean (`myshell-ai/MeloTTS-Korean`) | MeloTTS | MIT |
| English | Kokoro-82M, voice `af_heart` (`hexgrad/Kokoro-82M`) | Kokoro | Apache-2.0 |

## Script

| Scene | Korean | English |
| --- | --- | --- |
| 0:00 title | 코드에서 산출물까지. | From code to deliverables. |
| 0:03 problem | 코드는 계속 바뀌는데, 문서는 그대로입니다. | The code keeps changing. The documents don't. |
| 0:08 code to spec | 폴더를 열면, 코드를 읽어 명세서가 만들어집니다. | Open a folder, and get the interface spec. |
| 0:14 deliverables | 명세서에서 문서까지, 한 작업대에서. | From spec to documents, in one workbench. |
| 0:19 diffs | 코드가 바뀌면 변경을 검토하고, 승인한 것만 적용합니다. | When code changes, review the update, then apply only what you approve. |
| 0:25 your PC | 쓰던 에이아이를 내 피씨에서. | The AI you already use, on your PC. |
| 0:28 call to action | 무료 다운로드. | Free Windows download. |

Korean is written the way it is spoken (`에이아이`, `피씨`) and a few phrases avoid
words the model slurred at the start of a sentence, so the narration is not a
word-for-word reading of the on-screen captions.

## Checking a new mix

Transcribe each line back with a speech recognizer and compare it with the script
before shipping: a voice that sounds fine in a waveform can still mispronounce a
word. The tracks here were checked that way with Whisper (small), which heard every
English line exactly and every Korean line apart from notation (`AI`, `PC`).
The result is not a listening test, so play each language once before releasing.
