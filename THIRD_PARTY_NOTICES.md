# Third-Party Notices

MonoField is a derivative of the Apache-2.0 licensed
[Open Design](https://github.com/nexu-io/open-design) project. See `NOTICE`
for the upstream attribution and fork provenance, and `LICENSE` for the
Apache License 2.0 text that covers the repository as a whole.

This file records the third-party components bundled inside this repository
that carry their own licenses. It was last verified on 2026-08-06.

## Bundled plugins, skills, and design templates

Plugin, skill, and design-template descriptors (`open-design.json`) declare
their own `license` field. As of the verification date the breakdown across
477 bundled descriptors is:

| License | Count |
| --- | --- |
| MIT | 349 |
| CC-BY-4.0 | 91 |
| Apache-2.0 | 37 |

73 component directories additionally bundle their own `LICENSE` file
(36 under `design-templates/`, 24 under `plugins/`, 13 under `skills/`).
These files must be preserved and distributed with their component.

Representative upstream authors of bundled MIT-licensed template packs:

- `design-templates/guizang-ppt/` — Copyright (c) 2026 op7418 (歸藏), MIT
- `design-templates/html-ppt/` — Copyright (c) 2026 lewis, MIT
- `design-templates/html-ppt-zhangzara-*/` — Zara Zhang, MIT
- `plugins/community/hallmark/` — Nutlope, MIT

## Release checks

- Run a formal dependency license scan (e.g. `license-report`) against the
  pnpm workspace before each public release. A spot check on 2026-07-07
  found no GPL/AGPL/LGPL packages, but the lockfile changes over time.

## npm dependencies

Runtime and build dependencies are declared in the workspace `package.json`
files and resolved in `pnpm-lock.yaml`. They are fetched from the npm
registry at install time under their respective licenses and are not
vendored into this repository.
