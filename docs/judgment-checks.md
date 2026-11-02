# Judgment checks with JEV and Laya

MonoField uses a System One decision model — hosted [TypeSafe JEV](https://docs.typesafe.ai) or a local
[Laya](https://github.com/NandhaKishorM/laya) server — as a **judgment tool** that checks, item by item, what an
AI agent wrote into an interface specification:

- **Korean field labels**: does `korean_label` mean the English `identifier`? (`createdAt → 삭제일시` is wrong.)
- **Business names**: does the business name describe the endpoint? (`POST /api/v1/orders → 회원 탈퇴` is wrong.)

It runs in the interface specification editor (**판단 검토**), through `monofield judge`, and through
`POST /api/projects/:id/judgments/check`. Configure the backend once under **Integrations → JEV / local decisions**
or with `monofield jev configure` (see [JEV and local typed decisions](jev-decisions.md)).

## Why this shape

The design follows how the providers document their own models.

| Provider guidance | How MonoField applies it |
| --- | --- |
| JEV is for "verify the input prompt, extractions, reasoning traces, tool calls, or inputs of any other AI" ([use-case map](https://docs.typesafe.ai/concepts/use-case-map.md)) | The judge verifies items another agent (Codex, Claude Code) extracted into a specification. |
| "Ask the most explicit, narrow, specific, atomic questions you can"; keep deterministic rules in code ([how to build](https://docs.typesafe.ai/concepts/how-to-build-with-system-one.md)) | One yes/no (`noul`) question per item. Empty labels and labels left in English (`member Id`) are decided by code and never sent to a model. |
| Noul: "0.7 for yes and 0.3 for no" is a starting point; values between go to a person ([noul](https://docs.typesafe.ai/primitives/noul.md)) | Three verdicts: pass, review, flag. The band between the thresholds is left for review. |
| Thresholds come from your own labelled data; "Test thresholds by plotting confidence against accuracy on your data" (JEV); shadow → compare → policy → bounded promotion ([Laya staged adoption](https://github.com/NandhaKishorM/laya/blob/main/docs/staged-adoption.md)) | Every backend+model+question starts in **observe** mode: answers are shown, never flagged. Reviewer labels build a scorecard; a policy is applied only when the labels support one and the reviewer applies it. |
| Laya's batch endpoint answers one question set over up to 64 states | A local server is asked one batch per kind; repeated items (the same field on several endpoints) are asked once. Hosted JEV has no batch endpoint, so items go one per request, four at a time, and only after the caller allows sending identifiers, labels and paths to TypeSafe. |
| The base Laya checkpoints score near chance zero-shot; fine-tuning on your own decisions is where the value is ([fine-tuning](https://github.com/NandhaKishorM/laya/blob/main/docs/finetune.md)) | `monofield judge export` writes the reviewer's labels, and `--seed` a built-in SI seed set, as `laya-train` / `laya-evals` JSONL. |

What the models are not for, per the same documentation: generating text, counting, arithmetic, dates, multi-hop
reasoning, or acting as an approval. A judgment is advisory; it never edits the specification.

## Measured: the stock multilingual checkpoint

Local Laya 0.4.20, checkpoint `multilingual` (revision `55cf4c4e`), CPU, hand-labelled SI questions written for this
evaluation (not from the training set):

| Question | Cases | Accuracy | Rank quality (AUC) |
| --- | --- | --- | --- |
| Korean field label matches identifier | 20 | 0.50 | 0.63 |
| Business name fits endpoint | 16 | 0.50 | 0.55 |
| Evidence supports a claim (3 options) | 12 | 0.50 | — |
| Compatibility level of a change (3 options) | 12 | 0.50 | — |

It is confidently wrong on obvious cases (`createdAt → 삭제일시` scored 0.955 yes) and scores correct labels low
(`quantity → 주문수량` 0.03). That is why nothing is flagged by a model until a policy is applied. Batched calls took
80–150 ms per item on a 4-core CPU; a single warm call about 260 ms.

## Fine-tuned SI judge

On the built-in seed set's held-out split (`monofield judge export --seed heldout`: 378 items whose fields and
resources never appear in the train split), the stock `multilingual` checkpoint scored:

| Question | Items | Accuracy at 0.5 | AUC | Flag precision / recall at ≤ 0.3 |
| --- | --- | --- | --- | --- |
| Korean field label | 90 | 0.756 | 0.891 | 0.933 / 0.467 |
| Business name | 288 | 0.375 | 0.539 | 0.417 / 0.026 |

So the stock model separates easy label mismatches but not same-family confusions (the hand set above), and it
cannot judge business names.

A fine-tune on the train split (`laya-train` with the recipe below, base `multilingual`, 8 epochs, about 40 minutes
on a 4-core CPU) was scored by `laya-train --eval-data` on the same 378 held-out items, both kinds together:

| | Accuracy | Loss | ECE | Brier | Mean confidence |
| --- | --- | --- | --- | --- | --- |
| Before (stock) | 0.466 | 1.224 | 0.331 | 0.739 | 0.797 |
| After (fine-tuned) | 0.868 | 0.464 | 0.104 | 0.231 | 0.971 |

The fine-tuned model is confident (mean 0.97) and its calibration temperature hit the upper clamp (5.0), so treat
its probabilities as rankings until your own labels say otherwise. A second, independent training run with the same
recipe reproduced these numbers exactly (accuracy 0.4656 → 0.8677, ECE 0.3311 → 0.1043).

Both checkpoints served side by side (`LAYA_EXTRA_MODELS`) and scored per question on the same held-out file
through `/v1/systemone/batch`, with the same wire format MonoField uses:

| Question | Model | Accuracy at 0.5 | AUC | Flag precision / recall at ≤ 0.3 |
| --- | --- | --- | --- | --- |
| Korean field label (90 items, 60 wrong) | stock | 0.756 | 0.891 | 0.933 / 0.467 |
| | fine-tuned | 0.933 | 0.974 | 0.935 / 0.967 |
| Business name (288 items, 192 wrong) | stock | 0.375 | 0.539 | 0.417 / 0.026 |
| | fine-tuned | 0.847 | 0.915 | 0.868 / 0.922 |

Two-thirds of the held-out items are wrong ones, so "always wrong" would already score 0.67 accuracy; read the AUC and
the flag columns. The held-out file is synthetic and templated: its wrong items are swaps and look alike, so these
numbers say the model learned the pattern, not how it does on your documents.

### Against a specification with planted errors

`monofield judge check` on a 3-endpoint, 15-item specification with three planted errors (`POST /api/v1/orders →
회원 탈퇴`, `memberId → 주문번호`, `createdAt → 삭제일시`), observe mode, local backend, two batch calls (about
1.2–1.4 s on CPU), probability that the item is right:

| | Stock | Fine-tuned |
| --- | --- | --- |
| `POST /api/v1/orders → 회원 탈퇴` (planted) | 0.73 | **0.01** |
| `memberId → 주문번호` (planted) | 0.77 | **0.01** |
| `createdAt → 삭제일시` (planted) | 0.96 | **0.03** |
| 12 correct items | 0.03 – 0.96, no pattern | 8 at 0.98 – 0.99; **4 at 0.01 – 0.16** |

The stock model misses all three, as before. The fine-tuned model ranks all three planted errors lowest, but it also
gives four correct items a low score: `id → 주문 ID` (0.01), `status → 주문 상태` (0.02, on two endpoints) and
`amount → 결제 금액` (0.16). Very short, generic identifiers are the weak spot; the seed vocabulary is built from
longer, more specific fields. On this example a flag at ≤ 0.3 would have been right 3 times in 7 (precision 0.43),
far below the held-out 0.87 – 0.94. That is the reason the default stays observe mode, and why a policy needs your
own labels (the 성적표 section) before flags turn on: mark these generic fields correct and they become training
data for the next `laya-train` run (`monofield judge export`).

## Use it

**UI**: open an `*.interface-spec.json`, then **판단 검토 → 판단 검토 실행**. Suspects are listed first. Mark model
answers 맞음 / 틀림; the **성적표와 적용 기준** section shows, per model and question, the labels, AUC, and a
suggested policy with its flag precision and recall. **이 기준 적용** turns flags on; **관찰로 되돌리기** turns them
off. **학습 데이터 내보내기** downloads the labels.

**CLI** (same HTTP routes):

```sh
monofield judge check --project <id> --input docs/orders.interface-spec.json [--allow-hosted] [--json]
monofield judge feedback --kind field-label --identifier createdAt --label 삭제일시 --correct no --probability 0.08
monofield judge scorecard --json
monofield judge policy --kind field-label --apply      # or --observe
monofield judge export --out labels.jsonl
monofield judge export --seed train --out train.jsonl  # --seed heldout uses unseen fields and resources
```

**HTTP**: `POST /api/projects/:id/judgments/check`, `POST /api/judgments/feedback`, `GET /api/judgments/scorecard`,
`PUT /api/judgments/policy`, `GET /api/judgments/dataset?kind=&seed=`. Labels and policies are daemon data; see the
[daemon data directory contract](../AGENTS.md#daemon-data-directory-contract).

A policy needs at least 20 labelled model answers including incorrect ones, and a flag band in which at least 80%
of flags were incorrect items. Without that the pair stays in observe mode.

## Train a local SI judge

```sh
monofield judge export --seed train   --out train.jsonl
monofield judge export --seed heldout --out heldout.jsonl
monofield judge export                --out labels.jsonl   # your reviewed items, optional
cat train.jsonl labels.jsonl > data.jsonl
laya-train --data data.jsonl --eval-data heldout.jsonl --base multilingual \
  --max-len 128 --head-max-len 192 --epochs 8 --micro-batch 8 --grad-accum 4 --shuffle-options --out ./si-judge
LAYA_EXTRA_MODELS='{"si-judge": "./si-judge"}' LAYA_MODELS=multilingual,si-judge LAYA_HOST=127.0.0.1 laya-serve
monofield jev configure --backend local --local-url http://127.0.0.1:8000 --model si-judge
```

The held-out file uses fields and resources the train split never contains, so its score is a fair check of
generalization on this kind of data; it is still synthetic. Label real items in observe mode before applying a
policy.

## Limits

- Two question kinds today. Evidence-vs-claim and compatibility second opinions were measured at chance on the
  stock checkpoint and are not wired.
- The model sees only the subject (identifier and label, or method, path and business name), never source code.
- Hosted JEV was not measured here (no key); its documentation says CJK languages are handled "not equally well".
