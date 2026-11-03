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

The numbers above are for the seed set as it was on 2026-11-02 morning (378 held-out items, 882 train items). Later the
seed gained short generic identifiers (below); the file now has 492 held-out and 1,110 train lines, and the 378 are still in
it unchanged.

### A second fine-tune: short generic identifiers

The first fine-tune scored very short, generic identifiers low even when the label was right (`id → 주문 ID` 0.01), because
the seed's long, specific fields (`memberId`, `orderStatus`) never taught that a generic `id` or `amount` takes "qualifier +
concept" labels. `SEED_GENERIC_TRAIN` / `SEED_GENERIC_HELDOUT` in `apps/daemon/src/services/judgment-seed.ts` add 51 such
identifiers (`name`, `code`, `qty`, `regDt`, `custNm`, ... for training; `id`, `status`, `amount`, `state`, `rgstDt`, `ordAmt`,
... held out) with a right label and two wrong ones each. They are written out, not shuffled, so every other split is
unchanged and the held-out identifiers stay unseen. A second fine-tune with the same recipe on the larger train split
(1,110 lines) was served next to the first (`v1`) and the stock model and scored on the 492 held-out lines:

| Field label, held-out subset | Model | Accuracy at 0.5 | AUC | Flag precision / recall at ≤ 0.3 |
| --- | --- | --- | --- | --- |
| Original (90 items, 60 wrong) | stock | 0.756 | 0.891 | 0.933 / 0.467 |
| | v1 | 0.933 | 0.974 | 0.935 / 0.967 |
| | v2 | 0.889 | 0.958 | 0.902 / 0.917 |
| Generic (114 items, 76 wrong) | stock | 0.763 | 0.818 | 0.891 / 0.750 |
| | v1 | 0.833 | 0.868 | 0.835 / 0.934 |
| | v2 | 0.877 | 0.949 | 0.878 / 0.947 |

Business names (288 items) are the same file as before: stock AUC 0.539, v1 0.915, v2 0.924 (flag precision/recall
0.417/0.026, 0.868/0.922, 0.882/0.938). The held-out evaluation printed by `laya-train` for v2 was accuracy 0.535 → 0.870, ECE
0.274 → 0.100 (v1 on its 378: 0.466 → 0.868, 0.331 → 0.104).

So the generic identifiers help where they were meant to (AUC 0.868 → 0.949 on unseen generic fields) and the original subset
got a little worse (0.974 → 0.958). These are two single training runs whose loss curves differ (v2's final-epoch loss
was 0.33, v1's 0.06), so a difference of this size may be run-to-run noise as much as data; repeat a run before reading it as
a trade-off. Per generic identifier, v2's mean probability for the right labels is ≥ 0.87 for `amount`, `state`, `image`,
`parentId`, `time`, `text`, `value`, `number`, `updtDt`, but still 0.60 for `status`, 0.50 for `statCd`, 0.37 for `dlvAddr` and
about 0.04 for the abbreviations `ordAmt` and `userNm`, and 0.03 for `rgstDt` (v1 gave `rgstDt` 0.99): abbreviations the
training set did not contain are not generalized.

### A third fine-tune: Korean legacy abbreviations

Legacy Korean schemas write `CUST_NM`, `ordAmt`, `rgstDt`. `SEED_ABBREVIATION_TRAIN` / `SEED_ABBREVIATION_HELDOUT` in
`apps/daemon/src/services/judgment-seed.ts` generate such identifiers from a prefix table (`cust` 고객, `ord` 주문, ...) and
a suffix table (`Nm` 명, `Amt` 금액, `Dt` 일자, ...): 72 identifiers for training, 32 held out. Two stems (`comp`, `rsv`) are
held out whole and one combination in four of every other stem; each right label comes with two wrong ones (another suffix
family, or another prefix group). **The held-out set is therefore new stems and combinations built from the same suffix
vocabulary, not abbreviations from outside the tables.** A third fine-tune with the same recipe on the 1,326-line train split
(`laya-train` held-out evaluation on 588 lines: accuracy 0.524 → 0.871, ECE 0.271 → 0.098, mean confidence 0.794 → 0.969; the
calibration temperature again hit the 5.0 clamp, so read the probabilities as rankings) was served next to the other three
and scored on the 588 held-out lines. Field label, per held-out subset:

| Held-out subset | Model | Accuracy at 0.5 | AUC | Flag precision / recall at ≤ 0.3 |
| --- | --- | --- | --- | --- |
| Abbreviation (96 items, 64 wrong) | stock | 0.469 | 0.539 | 0.652 / 0.234 |
| | v1 | 0.698 | 0.629 | 0.727 / 0.875 |
| | v2 | 0.719 | 0.687 | 0.765 / 0.812 |
| | v3 | 0.844 | 0.899 | 0.857 / 0.938 |
| Generic (114 items, 76 wrong) | v2 | 0.877 | 0.949 | 0.878 / 0.947 |
| | v3 | 0.912 | 0.975 | 0.922 / 0.934 |
| Original (90 items, 60 wrong) | v2 | 0.889 | 0.958 | 0.902 / 0.917 |
| | v3 | 0.933 | 0.981 | 0.951 / 0.967 |

Business names (288 items): v3 accuracy 0.844, AUC 0.907, flag precision/recall 0.863 / 0.922, against v2 0.865, 0.924,
0.882 / 0.938 and v1 0.847, 0.915, 0.868 / 0.922, so no gain there and a slightly lower number, within what one run can
move. v3 flags 70 of the 96 abbreviation items and 10 of those flags are right labels. Probability that a right label is
right, for identifiers that scored low before (one request per label, the two labels of a row separated by a slash):

| Identifier → label | v1 | v2 | v3 |
| --- | --- | --- | --- |
| `userNm` → 사용자명 / 사용자 이름 | 0.03 / 0.02 | 0.04 / 0.04 | **0.98 / 0.98** |
| `dlvAddr` → 배송 주소 / 배송지 주소 | 0.02 / 0.79 | 0.03 / 0.71 | **0.99 / 0.99** |
| `ordAmt` → 주문액 / 주문 금액 | 0.01 / 0.01 | 0.04 / 0.03 | **0.99** / 0.03 |
| `rgstDt` → 등록일자 / 등록일시 | 0.99 / 0.99 | 0.03 / 0.03 | 0.02 / 0.06 |
| `status` → 주문 상태 / 배송 상태 | 0.02 / 0.03 | 0.03 / 0.39 | **0.99** / 0.02 |
| `statCd` → 상태 | 0.01 | 0.02 | 0.02 |
| `id` → 주문 ID | 0.01 | 0.02 | 0.08 |

So the tables help where they were built to (new stems, unseen `userNm`, `dlvAddr`), and `rgstDt` is still wrong: `rgst` is
not a stem in the tables, which is the fair test of an abbreviation from outside them. `ordAmt → 주문 금액` (0.03) and
`status → 배송 상태` (0.02) are right labels that stay flagged even though their sibling labels pass. These are single
training runs (the loss per epoch was 0.526, 0.355, 0.238, 0.531, 0.468, 0.180, 0.165, 0.110, not a smooth curve); the
earlier runs showed the original subset moving by about 0.02 AUC between recipes, so differences of that size say little.

### Against a specification with planted errors

`monofield judge check` on a 3-endpoint specification with three planted errors (`POST /api/v1/orders → 회원 탈퇴`,
`memberId → 주문번호`, `createdAt → 삭제일시`), observe mode, local backend, two batch calls (about 1.2–1.4 s on CPU).
Probability that the item is right, for each distinct item (a label that appears on two endpoints is one item):

| Item | Stock | v1 | v2 | v3 |
| --- | --- | --- | --- | --- |
| `POST /api/v1/orders → 회원 탈퇴` (planted) | 0.73 | **0.01** | **0.01** | **0.01** |
| `memberId → 주문번호` (planted) | 0.77 | **0.01** | **0.06** | 0.94 (missed) |
| `createdAt → 삭제일시` (planted) | 0.96 | **0.03** | **0.03** | **0.02** |
| `id → 주문 ID` | 0.03 | 0.01 | 0.02 | 0.08 |
| `status → 주문 상태` | 0.38 | 0.02 | 0.03 | 0.99 |
| `amount → 결제 금액` | 0.95 | 0.16 | 0.99 | 0.99 |
| `deletedAt → 탈퇴 일시` | 0.44 | 0.98 | 0.50 | 0.98 |
| `orderNo → 주문번호` | 0.21 | 0.99 | 0.99 | 0.99 |
| the other five correct items | 0.82 – 0.96 | 0.99 | 0.89 – 0.99 | 0.97 – 0.99 |

The stock model misses all three planted errors and flags two correct items. v1 and v2 rank all three planted errors lowest.
With flags at ≤ 0.3, v1 raised 6 flags (3 planted, precision 0.50) and v2 raised 5 (3 planted, precision 0.60); the held-out
files say 0.84 – 0.94. v2 fixed `amount → 결제 금액` but `id → 주문 ID` and `status → 주문 상태` stay low (`id` and `status`
are held out of the generic training set on purpose, so they stay an honest test), and it now doubts `deletedAt → 탈퇴 일시`
(0.50). **v3 raised 3 flags (2 planted, precision 0.67, recall 0.67): it fixed `status`, `amount` and `deletedAt`, kept the
`id → 주문 ID` false flag, and missed the planted `memberId → 주문번호` (0.94), which both earlier checkpoints had caught.**
The cause is not tested. One reading: the abbreviation tables put `Id` and `No` in the same family and never offer one as
the wrong label for the other, so a "member identifier" paired with "주문번호" was never shown as an error. With three planted
errors one miss is a third of the recall, and these are single runs, so this is a warning about trusting v3 over v2 on
identifier/number swaps, not a ranking of the checkpoints. Which of these were unseen: `memberId` and every generic item are held out of both training
sets, while `createdAt` and the resource `orders` are in the seed's train split, so those two planted catches are not a
generalization test. That is why the default stays observe mode and why a policy needs your own labels (the 성적표 section)
before flags turn on: mark the generic fields correct and they become training data for the next `laya-train` run
(`monofield judge export`).

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
