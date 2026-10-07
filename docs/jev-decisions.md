# JEV and local typed decisions

MonoField exposes System One decisions under **Integrations → JEV / local decisions** and through `monofield jev`. These models answer closed questions (`choice`, `score`, `noul`). Codex, Claude and other coding agents still write code. A prediction is advisory: it does not grant permissions, run commands or change the selected coding agent.

## Hosted TypeSafe JEV

The [official SDK](https://github.com/typesafe-ai/typesafe-sdk-js) is MIT licensed. The [official quickstart](https://docs.typesafe.ai/introduction/quickstart) requires a TypeSafe API key for the hosted model. Public SDK source does not include JEV model weights or a self-hosted inference server. No JEV weights were found in the official public repositories during this integration.

Obtain a key from [TypeSafe](https://console.typesafe.ai/keys). Save it in the password field, or set `TYPESAFE_API_KEY` in the daemon environment. Saved keys use MonoField's existing encrypted credential vault; configuration files contain no raw keys. Stored credentials take precedence over the environment. Removing a stored key does not remove an environment variable.

```sh
monofield jev configure --backend typesafe --model jev-latest --json
monofield jev set-key --prompt-file - --json
monofield jev models --json
```

For `set-key`, supply the key through standard input or a protected file. Do not include it in command arguments, project files or chat. Model names should come from the authenticated model list. Hosted requests go only to `https://api.typesafe.ai`; redirects are refused.

## Local compatible models

[Laya](https://github.com/NandhaKishorM/laya) publishes Apache 2.0 code and weights, including a multilingual checkpoint. It is a separate model, not a local copy of JEV. Its server implements the same typed decision endpoint. It requires Python, PyTorch, disk space for weights and sufficient RAM. The model server is a separately managed process; MonoField does not install it or keep it running automatically.

An example CPU installation in your own Python virtual environment:

```sh
python -m venv .venv
# Activate that environment before installing.
python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
python -m pip install 'laya[serve]==0.3.28' 'transformers<5'
```

Run only the multilingual checkpoint on loopback. The environment assignments below use POSIX shell syntax; set the equivalent variables in PowerShell on Windows.

```sh
LAYA_HOST=127.0.0.1 LAYA_PORT=8000 LAYA_DEVICE=cpu LAYA_THREADS=2 \
LAYA_MODELS=multilingual LAYA_PRELOAD=1 LAYA_DEFAULT_MODEL=multilingual \
LAYA_JEV_STRICT=1 LAYA_REVISION=reviewed laya-serve
```

`LAYA_REVISION=reviewed` selects the checkpoint revision pins included in the installed Laya package. Review the pinned source and weight licenses before distributing them in your own product. This example downloads only the selected checkpoint. The initial download/load is slower than a warm decision request.

```sh
monofield jev configure --backend local --local-url http://127.0.0.1:8000 --model multilingual --json
monofield jev models --json
monofield jev triage --prompt-file request.txt --json
```

The local URL must be loopback, without URL credentials, query or fragment. MonoField never forwards a TypeSafe key to the local server and does not configure an external proxy for loopback requests. Laya has no `/v1/models` endpoint in the tested version; discovery falls back to the actual `/health` list of resident models. A stopped server produces a connection error and can be retried after restarting it.

## Custom decisions and limits

`monofield jev decide --request-file request.json --json` forwards a typed request through the same production HTTP routes as the UI. `--request-file -` and `--prompt-file -` accept standard input. `--daemon-url` selects an existing MonoField daemon.

```json
{
  "model": "multilingual",
  "state": "The customer was charged twice and requests a refund.",
  "questions": {
    "team": {
      "type": "choice",
      "instructions": "Which department should handle this request?",
      "criteria": { "billing": "Payments and refunds", "technical": "Software defects" }
    }
  }
}
```

HTTP surfaces are `GET /api/jev/status`, `PUT /api/jev/config`, `GET /api/jev/models`, `POST /api/jev/decide`, and `POST /api/jev/triage`. Credential operations reuse `/api/byok/credentials`. Configuration follows the root [daemon data directory contract](../AGENTS.md#daemon-data-directory-contract).

MonoField limits input to 256 KiB, 1–16 questions and 1–100 criteria per question, and limits response JSON to 1 MiB. These are app limits, not a promise about every provider's supported context. Requests time out after 45 seconds. Invalid answer names, types, options, probabilities, score legends and usage values are rejected rather than shown as successful decisions. Zero output tokens are displayed only when the provider reports zero; no cache usage or price is inferred.

The UI preset estimates request type, change risk and clarification likelihood. Laya and JEV define confidence differently; the same threshold must not be transferred between them without calibration. Clear decision formats do not guarantee correct judgments. Validate on examples from your own workflow before relying on either model.

See the [native development and local-model validation notes](validation/2026-10-07-codex-and-local-decisions.md) for the observed workflow, provider-reported tokens, actual local inference and tested recovery paths.
