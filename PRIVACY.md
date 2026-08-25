# Privacy

This page describes the current MonoField data handling policy. MonoField is
local-first and is intended to run without a MonoField cloud account.

## Short Version

- MonoField does not send product telemetry.
- MonoField does not send product analytics, startup reports, reliability
  events, quality traces, artifact manifests, screenshots, prompts, responses,
  tool input, or tool output to a MonoField-operated telemetry service.
- MonoField does not store your conversation, tool content, projects, generated
  files, screenshots, or BYOK keys on a MonoField server.
- Projects, generated files, app settings, and BYOK/provider credentials are
  stored locally on your machine.
- When you run an agent, the prompt and required context are sent only to the
  local CLI, BYOK/model provider, local model endpoint, or external integration
  you selected for that task. That runtime's own policy applies.

## Local Data

MonoField may store local runtime data on your machine, including:

- app settings
- selected local agent or BYOK provider configuration
- project metadata
- generated artifacts and exports
- local daemon state
- plugin or template state

These files are local application data. They are not uploaded to a MonoField
server.

BYOK keys and local CLI credentials are used only to talk to the provider or CLI
you configured. MonoField does not send those secrets to a MonoField-operated
service.

## Model And Agent Input

MonoField does not provide a managed model router in the current MVP.

When you ask an agent to work, MonoField sends the required input to the runtime
you selected, for example:

- a local coding agent CLI such as Codex, Claude Code, Cursor Agent, OpenCode,
  or another configured local agent
- a BYOK or OpenAI-compatible endpoint you configured
- a local model endpoint such as Ollama, LM Studio, vLLM, or a compatible local
  server
- an external integration that you explicitly configure and invoke

MonoField itself does not control whether that external runtime stores,
retains, trains on, or logs the input. You must check the policy and settings of
the selected CLI, model provider, local model server, or integration.

## Product Telemetry

MonoField product telemetry is disabled and has no active MonoField telemetry
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
should not cause MonoField telemetry to be sent.

## What MonoField Does Not Send

MonoField does not send these categories to a MonoField telemetry service:

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
identifier and keeps MonoField telemetry disabled.

Data already sent to an external model provider, local CLI, local model server,
or external integration is governed by that provider or integration's retention
policy.

## Managed Cloud Services

MonoField does not currently provide a managed cloud account, managed model
router, hosted wallet, or hosted credit service.

If a future MonoField Cloud, managed model-router service, telemetry program, or
hosted quality-review system is introduced, this policy and the code paths must
be updated before that feature is shipped.

## Changes To This Page

This document should be updated whenever MonoField data handling, model routing,
cloud-service behavior, telemetry behavior, or external integration behavior
changes.

For privacy questions, contact:

- Contact email: jhy0285@gmail.com
