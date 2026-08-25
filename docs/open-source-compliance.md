# Open-source compliance for MonoField releases

MonoField is an independent derivative of Apache-2.0 licensed Open Design and
bundles components under Apache-2.0, MIT, and CC-BY-4.0. This checklist is a
release gate, not a substitute for legal review.

## Required in every source and Desktop distribution

- The repository `LICENSE` containing the Apache License 2.0 text.
- `NOTICE` with upstream provenance and a prominent description of changes.
- `THIRD_PARTY_NOTICES.md` and every component-level `LICENSE` file.
- Attribution metadata for CC-BY-4.0 components, including author, title or
  component identity, license, and source URL where applicable.
- Source license propagation when a workflow, plugin, skill, or template is
  exported or republished. Never replace an inherited license with a default.

## Product boundary

- Primary UI and marketing use only the MonoField identity.
- Settings → About → Open-source notices carries the user-visible attribution.
- MonoField must not claim that all underlying code was written from scratch.
- Original product architecture, integrations, workflows, and modifications may
  be described as MonoField work while preserving upstream and third-party
  notices for the code and assets they cover.
- Public materials must state that MonoField is not affiliated with, endorsed
  by, or maintained by Open Design, OpenAI, Codex, or referenced model vendors.

## Security and privacy claims

- Say `local-first`, not `data never leaves the device` without qualification.
- MonoField does not operate a product telemetry sink in the current release.
- A selected external CLI, model provider, MCP server, connector, deployment
  target, or database receives only the data needed for the action; its own
  retention and security policy applies.
- Fully local or offline operation requires a local runtime plus an environment
  that blocks or disables external integrations and outbound network access.

## Before public launch

- Run the repository license/attribution audit and packaging tests.
- Confirm no secrets, credentials, customer data, or internal-only templates are
  included in a public marketplace bundle.
- Verify the selected `MonoField` mark in KIPRIS, WIPO Global Brand Database,
  relevant company-name registries, package registries, app stores, and target
  domains. A search with no obvious conflict is not trademark clearance.
- If the work was created in an employment context, obtain written confirmation
  of ownership and publication authority for the new modifications and brand.
