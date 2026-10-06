# MonoField download site

A standalone, buildless marketing and download site. HTML, CSS, and browser JavaScript are served directly; there are no frontend framework or runtime dependencies.

## Verify

From the repository root:

```bash
pnpm --filter monofield-site test
pnpm --filter monofield-site typecheck
```

The application runtime and its lifecycle remain separate. Follow the repository's `AGENTS.md` for MonoField app development.

## Vercel

Use the existing project that owns `monofield.vercel.app`.

- Git repository: `jhy0285/monofield`
- Production branch: `main`
- Root Directory: `apps/monofield-site`
- Framework Preset: Other
- Install Command and Build Command: skipped
- Output Directory: `.`

The site-local `vercel.json` specifies the static output and skips installation and build, so deploying this site does not install or build the MonoField application workspace. It also owns clean URLs, content types, cache rules, and the Content Security Policy.

Git integration requires the Vercel account to have access to this GitHub repository. CLI linking and deployment require authentication with the account or team that owns the existing project. Do not create an unrelated project to replace the existing domain.

## Published downloads and UI previews

Download links are initialized to the existing Windows installer, portable ZIP, and checksum assets. The browser reads the public GitHub latest-release API to update the version, sizes, and exact artifact URLs. It rejects draft/prerelease metadata and external artifact origins. If an artifact is missing, its action opens the release page. If the API is unavailable, the existing download links remain usable.

Workspace screenshots are actual app captures of the upcoming 0.11.6 UI and are labeled as previews. They do not imply a new installer has been published. The published version is obtained independently from the release API. The static SoftwareApplication metadata currently records the publicly available 0.11.5 version; update it when publishing a new stable release.

Microsoft Store is hidden until a valid listing ID is configured in `index.html`. Do not invent a listing or display an unverified Store download button.

The Korean/English language choice, project tabs, screenshot enlargement, mobile navigation, and FAQ work without a frontend framework. Disabled browser storage does not block navigation or downloads. The upstream license attribution remains on `/open-source`.
