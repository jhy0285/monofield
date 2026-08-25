# Translation guide

MonoField currently ships its product interface in 19 locales. The application
dictionaries are the maintained translation source:

```text
apps/web/src/i18n/locales/
```

The public README, quick start, contribution guide, and release instructions
are currently maintained in English so GitHub does not present outdated product
names, commands, download links, or security guidance. The previous translated
documents described a different product surface and were removed rather than
published as if they were current MonoField documentation.

## Adding or updating a UI locale

1. Copy `apps/web/src/i18n/locales/en.ts` to the target locale file when the
   locale is new, or edit the existing dictionary.
2. Keep product names, commands, paths, model names, and API identifiers
   unchanged.
3. Register new locales in `apps/web/src/i18n/types.ts` and
   `apps/web/src/i18n/index.tsx`.
4. Add the locale to `EXPECTED_LOCALES` in
   `apps/web/tests/i18n/locales.test.ts`.
5. Run:

```powershell
pnpm i18n:check
pnpm check:web
pnpm --dir apps/web exec vitest run tests/i18n/locales.test.ts
```

## Translating public documentation

Translate a public document only after its MonoField English source is stable.
Place a translation in `docs/i18n/` using
`<DOCUMENT>.<locale>.md`, preserve all MonoField links and commands exactly,
and add an explicit translation-status notice with the source commit. A
translated document must not reintroduce historic product names or deprecated
CLI and environment-variable examples.

The legal attribution in `README.md`, `NOTICE`, and
`THIRD_PARTY_NOTICES.md` must be preserved in every translated distribution.
