# Privacy

This page describes the current Open Docs data handling policy. Open Docs is
local-first and is intended to run without an Open Docs cloud account.

Open Docs is based on the Apache-2.0 Open Design codebase, but this policy
describes Open Docs behavior and product direction, not the original Open
Design cloud or AMR service.

## Short Version

- Open Docs does not send product telemetry.
- Open Docs does not send product analytics, startup reports, reliability
  events, quality traces, artifact manifests, screenshots, prompts, responses,
  tool input, or tool output to an Open Docs-operated telemetry service.
- Open Docs does not store your conversation, tool content, projects, generated
  files, screenshots, or BYOK keys on an Open Docs server.
- Projects, generated files, app settings, and BYOK/provider credentials are
  stored locally on your machine.
- When you run an agent, the prompt and required context are sent only to the
  local CLI, BYOK/model provider, local model endpoint, or external integration
  you selected for that task. That runtime's own policy applies.

## Local Data

Open Docs may store local runtime data on your machine, including:

- app settings
- selected local agent or BYOK provider configuration
- project metadata
- generated artifacts and exports
- local daemon state
- plugin or template state

These files are local application data. They are not uploaded to an Open Docs
server.

BYOK keys and local CLI credentials are used only to talk to the provider or CLI
you configured. Open Docs does not send those secrets to an Open Docs-operated
service.

## Model And Agent Input

Open Docs does not provide a managed model router in the current MVP.

When you ask an agent to work, Open Docs sends the required input to the runtime
you selected, for example:

- a local coding agent CLI such as Codex, Claude Code, Cursor Agent, OpenCode,
  or another configured local agent
- a BYOK or OpenAI-compatible endpoint you configured
- a local model endpoint such as Ollama, LM Studio, vLLM, or a compatible local
  server
- an external integration that you explicitly configure and invoke

Open Docs itself does not control whether that external runtime stores,
retains, trains on, or logs the input. You must check the policy and settings of
the selected CLI, model provider, local model server, or integration.

## Product Telemetry

Open Docs product telemetry is disabled and has no active Open Docs telemetry
sink.

The current code disables the inherited telemetry surfaces at the application
boundaries:

- browser analytics facade: no-op
- browser exception and safety reporting: no-op
- daemon analytics service: no-op
- daemon public analytics config: always disabled
- run-quality trace reporting: no-op
- object/artifact manifest relay: no-op
- AMR/Vela analytics mirroring: no-op
- packaged desktop startup failure capture: no-op
- packaged daemon spawn environment: does not forward telemetry relay or
  legacy telemetry keys
- packaging config: does not bake runtime telemetry keys

Because these paths are disabled, setting legacy telemetry environment variables
should not cause Open Docs telemetry to be sent.

## What Open Docs Does Not Send

Open Docs does not send these categories to an Open Docs telemetry service:

- BYOK API keys, auth tokens, JWTs, or local CLI credentials
- prompts, assistant responses, or conversation history
- tool input, tool output, command output, or error traces for product review
- project files, generated artifacts, screenshots, or exported documents
- artifact manifest metadata
- startup failure or crash reports
- anonymous product metrics
- raw local filesystem paths

## Clearing Local Privacy State

Settings -> Privacy -> Clear local privacy state removes any legacy anonymous
identifier and keeps Open Docs telemetry disabled.

Data already sent to an external model provider, local CLI, local model server,
or external integration is governed by that provider or integration's retention
policy.

## Open Docs Cloud And AMR

Open Docs does not currently provide Open Docs Cloud, Open Design AMR, Vela
login, wallet, credits, or a managed model-router service in the MVP.

If a future Open Docs Cloud, managed model-router service, telemetry program, or
hosted quality-review system is introduced, this policy and the code paths must
be updated before that feature is shipped.

## Changes To This Page

This document should be updated whenever Open Docs data handling, model routing,
cloud-service behavior, telemetry behavior, or external integration behavior
changes.

For privacy questions, contact:

- Contact email: jhy0285@gmail.com
- Company email: whdudwls0285@lgcns.com
