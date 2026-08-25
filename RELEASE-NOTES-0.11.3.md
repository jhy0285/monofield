# MonoField 0.11.3

MonoField 0.11.3 keeps local agent and model choices current without adding a
managed model router or sending project data to MonoField.

## Highlights

- Codex now shows GPT-5.6 Sol, Terra, and Luna even when an older installed CLI
  reports only the previous model generation.
- The live Codex catalog is merged with reviewed recommendations. Future
  live-only models are surfaced automatically without waiting for a MonoField
  release.
- Agent and model catalogs refresh at startup, on manual rescan, and every six
  hours while the app remains open. The interval avoids repeated CLI probes
  during normal work.
- Claude Code retains the current Opus, Fable, Sonnet, and Haiku choices and
  stable aliases; OpenCode continues to use its live provider model listing.
- Windows adapter verification covered Codex CLI 0.149.1, Claude Code 2.1.245,
  Gemini CLI 0.56.0, and OpenCode 1.18.23.

## Data boundary

Model discovery invokes installed CLIs and reads their model metadata. It does
not send project files, prompts, credentials, or database content to MonoField.
Provider authentication and availability still follow the selected CLI and
account.
