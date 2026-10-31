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

## Published downloads and app captures

Download links are initialized to the existing Windows installer, portable ZIP, and checksum assets. The browser reads the public GitHub latest-release API to update the version, sizes, and exact artifact URLs. It rejects draft/prerelease metadata and external artifact origins. If an artifact is missing, its action opens the release page. If the API is unavailable, the existing download links remain usable.

Workspace screenshots are actual app captures of the 0.11.6 UI. The download version, sizes, and URLs are obtained independently from the public release API. The static SoftwareApplication metadata records the published 0.11.6 version; update it when publishing another stable release.

The hero and preview section also link to the published `0.11.7-preview.6` release by exact tag and asset name. These links do not use the stable release updater attributes, so a stable API response or a language change preserves the selected preview. The preview section has its own application metadata, installer, portable ZIP, checksums, release notes and development capture. The existing two stable download cards continue to follow the latest stable API. Update pinned preview URLs and sizes together when publishing another preview.

`monofield-preview-workspace.png` is the actual editor-and-diff capture from the committed development-workspace evidence dated 2026-10-18. Its caption identifies it as a development capture. Preview copy discloses the REA MCP integration, separate runtime/model prerequisites, and preview status. The handover section shows an actual REA capture of the explicitly labeled synthetic sample and links to the run report.

Microsoft Store is hidden until a valid listing ID is configured in `index.html`. Do not invent a listing or display an unverified Store download button.

The Korean/English language choice, project tabs, screenshot enlargement, mobile navigation, and FAQ work without a frontend framework. Disabled browser storage does not block navigation or downloads. The upstream license attribution remains on `/open-source`.

## Motion and the intro video

`motion.js` is a progressive layer on top of the static page: header tone, hero contour drawing, pointer parallax, scroll reveals, and the intro video controls. Without JavaScript every section is visible, and everything stands down under `prefers-reduced-motion`.

The 30-second intro in `/intro` (Korean and English MP4 plus posters) is a captioned motion piece with narration and a music bed. Its source is `intro-src/scene.html`, a pure function of time, so frames are exact; the sound lives in `intro-src/audio/` (see its README for the voices, script and licenses) and is muxed in as-is. Each MP4 must stay under 1 MiB because CI rejects larger changed files. Re-render and refresh both the site copy and the in-app copy (`apps/web/public/guide`) with:

```bash
pnpm --filter @open-design/e2e exec tsx scripts/render-intro-video.ts
```

It needs `ffmpeg` and fetches the OFL fonts (Inter, Noto Sans KR) from npm once into the OS temp directory. Add `--preview 2,9.5,16` to write still frames instead. `intro-src` is excluded from the Vercel deployment; the CSP only allows same-origin scripts, so the scene is a render source, not a page.
