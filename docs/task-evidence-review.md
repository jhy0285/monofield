# Opt-in review of task evidence

The general JEV triage preset classifies a request, estimates change risk and asks
whether clarification may be needed. Hosted JEV requires a TypeSafe key; Laya is
a separately installed compatible local model. Neither approves actions.

The recovered workspace also has explicit model-assisted verification candidate
selection and local-only ontology evidence ordering. Both keep deterministic
rules and evidence anchors; they do not approve actions or establish correctness.

The new **Integrations → JEV / local decisions → Review task evidence** disclosure
compares a short objective with concrete observations. It does not run on ordinary
chat messages or daemon startup. Choose implementation, design, external behavior
adaptation, or label review. This is an experimental semantic aid, not verified
task success. Design review reads supplied text/DOM observations, not pixels.
External-system review does not establish target ownership or reproduction rights.

`POST /api/jev/review` accepts:
```json
{
  "task": "design",
  "objective": "The narrow layout must keep the primary action visible.",
  "evidence": "At 375px the primary action is clipped outside the right edge."
}
```

The shared contract is `DecisionReviewInput`; response `DecisionReviewResult`
always has `advisory: true`. No evidence means no model call. The excerpt limits
are 200 objective characters and 600 evidence characters; do not silently submit a
whole document. This bound is not a promise that all tokenizers fit every input.
Known lexical secret/PII patterns are masked before forwarding. The selected
provider receives the masked supplied text; no automatic hosted fallback occurs.

Use the same endpoint from the CLI:
```sh
monofield jev review --request-file review.json --json
monofield jev review --prompt-file review.json --json
```

The checked provider configuration remains pinned through transport. A two-second
deadline covers configuration and inference. Two reviews may be active; excess
work returns unavailable rather than queuing behind coding. A bounded 64-entry,
three-minute in-memory cache requires identical input and provider configuration.
A cache hit reports no new usage; it does not manufacture zero provider tokens.

Supported/contradicted are model suggestions about the supplied statements.
Unknown, ambiguous probabilities, missing evidence, unavailable model or timeout
remain uncertain. Thresholds are heuristics, not domain-calibrated accuracy.
Even high probabilities can be wrong. Real test results, authorization, changing
code and deployment remain outside this tool.

## Evaluation status

Earlier first-party classification examples did not show an advantage over
simple rules. These new evidence-review tasks require a separate, fixed labeled
evaluation and end-to-end timing comparison with the same task without Laya.
Protocol tests prove input limits, configuration pinning, cache/deadline behavior
and interface wiring; they are not a substitute for live model quality.

Do not advertise a productivity or accuracy improvement until that comparison
passes on development/design/adaptation cases with unsupported and ambiguous
evidence, including shuffled options. The cloud executor was unavailable while
preparing this change; no fresh live inference or Windows release is claimed.
