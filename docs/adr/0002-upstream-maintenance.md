# 0002. Maintain MonoField as an independent fork focused on SI deliverables

## Status

Proposed — awaiting a core-maintainer decision. Nothing in this ADR removes code
by itself; each removal phase below lands as its own PR after acceptance.

## Context

MonoField started as a fork of the Apache-2.0 [Open Design](https://github.com/nexu-io/open-design)
project. The fork has since diverged in product direction:

- MonoField's distinct value is the Korean SI deliverable loop: interface spec
  XLSX, screen spec PPTX, evidence-backed spec updates from Git changes,
  governed database access, schema watch, change verification, and legacy
  handover (REA). None of these exist upstream.
- Upstream's center of gravity is design and media generation: image, video,
  audio, motion (HyperFrames), brand kits, a large design-system catalog, and an
  upstream cloud model router (AMR).

The repository still carries most of the upstream surface. As of 2026-10-22:

| Surface | Size | Used by the SI loop |
| --- | --- | --- |
| TypeScript in `apps/` and `packages/` | ~520k lines | Partly |
| Local CLI runtime adapters (`apps/daemon/src/runtimes/defs/`) | 25 | Codex and Claude Code are the documented engines |
| Skills (`skills/`) | 161 (2.9 MB) | A handful (document, deck, handover) |
| Design systems (`design-systems/`) | 152 (41 MB) | Rarely |
| Design templates (`design-templates/`) | 113 (39 MB) | Rarely |
| Media/video template plugins | ~20 MB | No |
| Media provider integrations (image/video/speech, AMR/Vela, xAI OAuth) | several daemon modules | No |
| Package scope `@open-design/*`, `OD_*` env vars, `od://` protocol | repository-wide | Naming only |

The project is maintained by one person. Every upstream merge must be reconciled
against the rebrand, the telemetry-off defaults, Windows-specific fixes, and the
SI features. Previous sessions recorded large test-suite drift from exactly
those causes.

## Decision

Treat MonoField as an **independent fork**:

1. **Stop wholesale upstream merges.** Do not merge upstream `main` into
   MonoField. Watch upstream releases and cherry-pick only:
   - security fixes,
   - agent-adapter fixes for the runtimes MonoField documents (Codex, Claude
     Code), and
   - fixes in shared infrastructure MonoField still uses (sidecar, packaging,
     artifact rendering).
   Record each cherry-pick's upstream commit in the PR body for provenance.
2. **Keep the Apache-2.0 obligations.** `LICENSE`, `NOTICE`, and
   `THIRD_PARTY_NOTICES.md` keep the upstream attribution, as required by
   [open-source compliance](../open-source-compliance.md).
3. **Shrink the default surface in phases** (each phase is a separate PR with
   its own validation):

   | Phase | Change | Reversible by |
   | --- | --- | --- |
   | A (done in this change) | Home leads with interface spec / screen spec / document / deck; design and media templates move behind "More templates". | UI toggle |
   | B | Hide media providers and AMR from onboarding and Settings unless explicitly enabled (AMR is already gated by `OD_ENABLE_AMR`). | Env flag |
   | C | Move media/video templates, most design systems, and design-only skills into an optional installable plugin bundle instead of shipping them in the default package. | Plugin install |
   | D | Mark non-Codex/Claude Code adapters as "community, unverified" in the runtime picker; remove adapters with no detected users after one release. | Revert PR |
   | E | Rename `@open-design/*` workspace packages and remaining public `od` naming to `@monofield/*` in one mechanical PR, keeping `OD_*` env vars as deprecated aliases for one release. | Revert PR |

## Alternatives considered

- **Keep following upstream.** Keeps design/media features current for free,
  but every merge costs reconciliation time that one maintainer cannot afford,
  and the shipped surface keeps growing in directions the target users do not
  need.
- **Hard fork and delete everything non-SI immediately.** Fastest reduction,
  but risks breaking flows existing users rely on and makes the change
  impossible to review. Phases A–E get the same result with a revert path at
  each step.
- **Rename packages first.** Cosmetic for users and very noisy for review;
  better done last (phase E) once removals have shrunk the tree.

## Consequences

- Upstream design/media improvements no longer arrive automatically.
- Package size, install size, and test-suite surface shrink with phases C and D,
  which also reduces Windows test drift.
- The CLI/UI dual-track rule in `AGENTS.md` still applies to every capability
  that remains; removed capabilities are removed from both surfaces in the same
  PR.
- Phase B onward needs a short user-facing note in release notes so existing
  users know where hidden features moved.
