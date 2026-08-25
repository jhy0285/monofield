# MonoField 0.11.2

MonoField 0.11.2 completes the public product-boundary migration and ships the
latest Desktop application.

## Highlights

- Public commands now use `monofield`; source workflows use the root scripts
  such as `pnpm build:web`, `pnpm check:web`, and `pnpm dev:desktop`.
- Public environment variables use `MONOFIELD_*`, with older names accepted
  only as read-compatible migration fallbacks.
- Desktop packaging uses the MonoField title, M mark, executable names, data
  directories, and `monofield://` application protocol.
- New extensions use `monofield.json`, `monofield-marketplace.json`, and the
  `monofield` manifest namespace.
- GitHub metadata and release checks target `jhy0285/monofield` through the
  canonical `/api/github/monofield` endpoints.
- The repository README, quick start, deployment examples, Helm chart, issue
  templates, and extension schemas now describe MonoField consistently.
- Stale translated upstream product documents and obsolete deployment examples
  were removed rather than published with incorrect names or security advice.

## Compatibility

Existing local projects and installations remain readable. Private workspace
package scopes, persisted storage keys, IPC names, and legacy manifest or
environment fallbacks are retained internally where migration safety requires
them. They are not public MonoField entry points.

Required Apache-2.0 and third-party attribution remains available in the
repository notices and in Desktop Settings.
