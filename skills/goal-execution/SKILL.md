---
name: goal-execution
en_name: "Goal execution"
ko_name: "목표 실행"
description: |
  Complete a bounded implementation goal in the current agent run, with explicit finish criteria and evidence-based verification. Use for requests that should continue through implementation and checks instead of stopping after a plan.
en_description: |
  Complete a bounded implementation goal in the current agent run, with explicit finish criteria and evidence-based verification.
ko_description: |
  현재 Agent 실행 안에서 명확한 완료 조건을 세우고 구현과 검증까지 끝내는 목표 실행 워크플로입니다.
triggers:
  - "finish this goal"
  - "keep going until done"
  - "implement and verify"
  - "끝까지 구현"
  - "완료할 때까지"
od:
  mode: prototype
  surface: web
  platform: desktop
  scenario: engineering
  category: engineering
  preview:
    type: markdown
  design_system:
    requires: false
---

# Goal execution

Use this skill for one bounded goal that should end in a verified result, not
only a plan or progress update. It applies to the current agent run. It is not
a background scheduler and does not create a third chat mode.

## Establish the finish line

Before changing anything, derive a compact goal contract from the user's
request and the selected project context:

- **Objective:** the concrete outcome to deliver.
- **Completion criteria:** observable checks that prove the outcome is done.
- **Constraints:** scope, compatibility, quality, security, and performance
  requirements already stated by the user or repository instructions.
- **Verification:** the smallest reliable test, build, inspection, or runtime
  check that covers the changed behavior.

Do this internally when the request is already clear. Ask the user only when a
missing choice would materially change the result or when new authority is
required.

## Execution loop

1. Inspect only the relevant project evidence and current state.
2. Make a short plan tied directly to the completion criteria.
3. Implement the next useful change.
4. Run proportional verification and inspect its actual output.
5. Compare the result with every completion criterion.
6. If a criterion is unmet and a safe in-scope fix is available, iterate.
7. Finish only when all required criteria pass or a genuine blocker remains.

Keep the loop efficient: reuse already-read context, avoid broad rescans and
duplicate commands, and do not inflate the prompt with unrelated files or
resource catalogs.

## Safety boundary

Selecting this skill never expands authority. Continue to obey repository,
sandbox, approval, credential, and external-system policies. In particular:

- do not perform destructive, production, publishing, messaging, purchasing,
  or credential-changing actions unless the user already authorized them;
- stop for a required approval or material product decision instead of
  guessing;
- do not weaken tests, security controls, or acceptance criteria merely to
  claim completion;
- report an unavailable external dependency or exhausted safe retry path as a
  blocker, with the completed evidence preserved.

## Completion report

At the end, state the delivered outcome first, then the verification evidence
and any remaining limitation. Never report the goal as complete when a required
criterion was skipped, failed, or could not be observed.

For work that must run again later, on a schedule, or after the current app
session ends, create an Automation instead. Automations provide durable
scheduled execution; this skill provides completion discipline inside the
current run.
