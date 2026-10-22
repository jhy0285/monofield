# REA / Laya release validation · 2026-10-22

Target: MonoField `0.11.7-preview.2`, incorporating the previous development workspace into the main release line and adding optional REA integration.

## Product behavior

- Settings → External MCP offers a REA preset pinned to `npx -y rea-agents@6.7.0 --mcp`.
- `monofield rea status|configure|disable --json` uses the same production MCP routes as Settings. It preserves unrelated encrypted credentials, refuses custom-ID collisions and reports configuration separately from connection availability.
- The bundled `legacy-system-handover` skill is discoverable through the real `/api/skills` endpoint. It covers explicit target selection, static/browser/SQLite observations, evidence provenance, unresolved questions and existing MonoField document rendering.
- Existing Laya integration remains an optional loopback typed-decision backend. The installation includes integration code and the workflow, not Laya model weights or an automatically managed inference server.
- Automatic external MCP forwarding supports Claude Code, OpenCode and supported ACP adapters. Codex requires separate registration in its own configuration. The existing UI support banner and the handover guide explicitly show that boundary.

## Validation

- Workspace dependency installation with pinned pnpm 10.33.2 and frozen lockfile succeeded. No lockfile change.
- `pnpm guard`: 67 guard tests passed.
- `pnpm typecheck`: workspace checks passed; the added Playwright test also passed package typecheck.
- Daemon: six focused suites, 111 tests passed, covering MCP configuration/REA CLI, local decision protocol, evidence review, verification advice and ontology context. After pinning REA 6.7.0, both configuration regression tests passed again.
- Web: four matching suites, 18 tests passed for local decision/evidence/ontology/verification UI.
- Packaging: 33 suites passed, one skipped; 221 tests passed and nine skipped. Windows installation/runtime validation is performed by the release workflow separately.
- Real MCP smoke: used the actual built MonoField REA template and Claude MCP export to launch the published pinned npm package over stdio. Enumerated its paginated catalog, then called `inspect_sqlite_database` against the controlled sample backup. REA returned the four expected tables with Evidence `ev_a0d66fdaaa20e64381d54ee08e39b83b3c33c4dbd83532aa276e64d6eed781e7`. The catalog contains 207 tools. This proves the configured server/analysis boundary, not an autonomous agent reasoning benchmark.
- Real browser: Playwright's shared tools-dev harness launched an isolated daemon/web runtime. The test selected REA in Settings, expanded the saved configuration, persisted the pinned command, verified it after reload and confirmed the bundled skill was discoverable. One test passed.
- Landing page: seven existing SEO checks passed. Chromium desktop/mobile Korean/English checks and actual production deployment verification are recorded with the site publication.
- The [earlier synthetic handover run](rea-handover-2026-10-22.md) and [reproduction example](../examples/rea-si-handover/README.md) cover the actual REA → collector → MonoField Excel/PPTX path. Laya was not called in that demonstration; local model protocol fixtures are not model-quality evidence.

## Findings preserved during validation

Published REA 6.4.0 does not advertise the SQLite operation used by the fork's source build. The product preset was updated to published **6.7.0**, and a real MCP call verified that operation before publication. The user-owned `rea-yj` source checkout remains an explicitly configured custom-server option.

The UI harness initially inherited npm's executable path through `npx`, preventing tools-dev startup. Running with the pinned Corepack pnpm launcher resolved it. The new MCP row opens collapsed; the acceptance test expands the real row before checking its command. Neither issue required a product workaround.

This remains a preview. The earlier full UI acceptance reports include unresolved coverage/failures; focused green checks and packaging validation do not assert that every development workflow is production-ready.

## Full CI and Windows follow-up

The full web unit job in [CI 39714465415](https://github.com/jhy0285/monofield/actions/runs/39714465415) reported **3,730 passed, 95 failed, 13 skipped** tests across 359 passing and 30 failing files. Failures include existing brand/prompt expectations, AMR/configuration interactions, localization and theme contracts. `git diff` confirms the complete `apps/web` tree is unchanged from the previous `0.11.7-preview.1` source (`6a9591be`). This publication does not claim to repair that backlog or pass the full CI suite.

The first [Windows release attempt](https://github.com/jhy0285/monofield/actions/runs/39714474718) stopped before packaging/publication: two PowerShell-launching tests exceeded the existing 20-second limit under four concurrent packaging workers. [PR #7](https://github.com/jhy0285/monofield/pull/7) limits Windows packaging tests to one worker while retaining all assertions and the same timeout. The Linux suite still passed 221 tests with nine skips. The fixed release source is `cec7c1e348702d0a285d3b4b5fe938a9fd900e61`; its [Windows build and smoke run](https://github.com/jhy0285/monofield/actions/runs/39715633397) is the publication gate.
