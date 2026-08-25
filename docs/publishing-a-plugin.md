# Publishing An MonoField Plugin

MonoField registry publishing is GitHub-backed in v1. The CLI remains the
canonical workflow; the product UI and agent flows wrap these commands.

## 1. Scaffold

```bash
monofield plugin scaffold --id figma-workflow --title "Figma workflow" --out ./plugins/community
```

The scaffold command creates `./plugins/community/figma-workflow/`. Plugin IDs
must be lowercase, start with a letter, and use only `[a-z0-9._-]`; slash-
separated registry paths are used by catalogs, not by `monofield plugin scaffold`.
The generated `monofield.json` is the MonoField sidecar next to `SKILL.md`.

## 2. Validate And Pack

```bash
monofield plugin validate ./plugins/community/figma-workflow --no-daemon
monofield plugin pack ./plugins/community/figma-workflow
```

The registry accepts anything that validates and packs. The source repository
does not need a special layout beyond `SKILL.md` plus `monofield.json`.
`monofield plugin pack` writes the archive next to the plugin folder by default.

## 3. Authenticate

```bash
monofield plugin login
monofield plugin whoami --json
```

These commands wrap GitHub CLI. Tokens stay in `gh`; MonoField does not store
GitHub credentials.

## 4. Publish

```bash
monofield plugin publish figma-workflow --to monofield --repo https://github.com/acme/figma-workflow
```

v1 opens the GitHub registry review flow. The publish payload includes the
plugin ID, version, repo, capability summary, and target registry entry path.
After merge, CI regenerates `monofield-marketplace.json`.

## 5. Install From The Registry

```bash
monofield marketplace refresh official
monofield plugin install figma-workflow
monofield plugin info figma-workflow --json
```

Installs preserve marketplace provenance, resolved source, manifest digest, and
archive integrity. `official` and `trusted` sources install as trusted;
`restricted` sources stay restricted until the user grants more trust.

## 6. Yank A Version

```bash
monofield plugin yank figma-workflow@1.0.0 --reason "Security issue"
```

Yanking never deletes metadata or bytes. New installs refuse yanked versions;
existing exact lockfile replays can still warn and proceed if the archive
remains reachable and integrity matches.
