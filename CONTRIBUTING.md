# Contributing to MonoField

Thanks for helping improve MonoField. Contributions are welcome across code,
browser and database tooling, document workflows, design systems, skills,
plugins, translations, tests, and documentation.

## Before you start

- Search [issues](https://github.com/jhy0285/monofield/issues) and
  [discussions](https://github.com/jhy0285/monofield/discussions) first.
- Keep changes focused and preserve the local-first security boundary.
- Never commit credentials, customer data, database samples, generated user
  artifacts, or private marketplace packages.
- New user-facing copy must use the MonoField identity and the existing i18n
  system.

## Local setup

MonoField requires Node.js 24 and pnpm through Corepack.

```powershell
git clone https://github.com/jhy0285/monofield.git
cd monofield
corepack enable
pnpm install
pnpm build:web
pnpm dev:desktop
```

Check the active local processes with:

```powershell
pnpm tools-dev status --json
```

## Validation

Run the checks that match your change. The common focused checks are:

```powershell
pnpm guard
pnpm check:contracts
pnpm check:web
pnpm build:web
pnpm check:daemon
```

Package-level tests may still use private workspace package identifiers in
their implementation. Those identifiers are not product commands or public
branding.

## Pull requests

A useful pull request includes:

- the user problem and intended behavior;
- the smallest coherent implementation;
- tests or a reproducible verification path;
- screenshots for visible UI changes;
- security and migration notes when data, permissions, or stored formats
  change.

Use `monofield` in CLI examples. Use `MONOFIELD_*` for newly documented
environment variables. Compatibility aliases for existing installations must
stay isolated from user-facing copy and should include a migration test.

## Extension contributions

Treat plugins, skills, MCP servers, templates, and connectors as executable
supply-chain inputs. Declare their source and license, request only the
capabilities they need, avoid secrets in manifests, and provide deterministic
validation where possible.

Community plugins belong under `plugins/community/`. A contribution should
include its instruction source, manifest, license metadata, and a small example
or test that demonstrates the intended workflow.

## License

By contributing, you agree that your contribution is licensed under the
repository's [Apache License 2.0](LICENSE). Preserve required copyright,
license, and third-party notices.
