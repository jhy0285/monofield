"""Live-probe connection gate for the Open Docs interface-spec pipeline.

Run this BEFORE any live probing to confirm the target server is reachable and
(if auth is provided) that credentials work. It performs ONE lightweight,
non-mutating request (HEAD, falling back to GET) and classifies the outcome so
the collector can decide whether to proceed.

Security:
  - Credentials are read from a local env file passed by PATH only
    (--cred-file). This script loads KEY=VALUE lines at runtime and never
    prints their values. Only header NAMES (not values) appear in output.
  - Only GET/HEAD are ever issued here — this gate never mutates.

Usage:
  python probe_check.py --url <base-or-full-url> [--path /health]
     [--cred-file probe.env] [--timeout 8]

Output: a single JSON object on stdout, e.g.
  {"ok": true, "status": 200, "reachable": true, "authOk": true,
   "detail": "200 OK", "elapsedMs": 142, "sentHeaderNames": ["Cookie"]}
Exit code 0 when reachable (regardless of auth), 1 when unreachable.

Credential env-file keys recognized (all optional):
  PROBE_HEADER_<NAME>   e.g. PROBE_HEADER_COOKIE=sid=...  ->  header "Cookie"
  PROBE_BEARER_TOKEN    ->  Authorization: Bearer <token>
"""

from __future__ import annotations

import argparse
import json
import ssl
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


def load_cred_headers(cred_file: str | None) -> dict[str, str]:
    """Load headers from a local env file WITHOUT ever printing their values."""
    headers: dict[str, str] = {}
    if not cred_file:
        return headers
    p = Path(cred_file)
    if not p.exists():
        raise SystemExit(f"--cred-file not found: {cred_file}")
    for raw in p.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key, val = key.strip(), val.strip()
        if key.upper().startswith("PROBE_HEADER_"):
            header_name = key[len("PROBE_HEADER_"):].replace("_", "-")
            headers[header_name] = val
        elif key.upper() == "PROBE_BEARER_TOKEN":
            headers["Authorization"] = f"Bearer {val}"
    return headers


def classify(status: int) -> tuple[bool, str]:
    if status in (401, 403):
        return False, f"{status} 인증 실패 — 크리덴셜을 확인하세요."
    if 200 <= status < 400:
        return True, f"{status} OK"
    if status == 404:
        return True, "404 — 서버엔 닿았으나 경로 없음(다른 --path로 재시도 가능)."
    return True, f"{status} — 서버 응답(비정상 코드)."


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", required=True, help="base URL or full URL to probe")
    ap.add_argument("--path", default="", help="path appended to base URL (e.g. /health)")
    ap.add_argument("--cred-file", default="")
    ap.add_argument("--timeout", type=float, default=8.0)
    ap.add_argument("--insecure", action="store_true", help="skip TLS verification")
    args = ap.parse_args()

    target = args.url.rstrip("/") + (("/" + args.path.lstrip("/")) if args.path else "")
    try:
        headers = load_cred_headers(args.cred_file or None)
    except SystemExit as err:
        print(json.dumps({"ok": False, "reachable": False, "detail": str(err)}, ensure_ascii=False))
        return 1

    ctx = ssl.create_default_context()
    if args.insecure:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

    def attempt(method: str):
        req = urllib.request.Request(target, method=method, headers=headers)
        start = time.monotonic()
        with urllib.request.urlopen(req, timeout=args.timeout, context=ctx) as resp:
            return resp.status, int((time.monotonic() - start) * 1000)

    status = None
    elapsed = None
    err_detail = None
    for method in ("HEAD", "GET"):
        try:
            status, elapsed = attempt(method)
            break
        except urllib.error.HTTPError as e:  # reachable, non-2xx
            status, elapsed = e.code, None
            break
        except (urllib.error.URLError, TimeoutError, ssl.SSLError) as e:
            err_detail = str(getattr(e, "reason", e))
            continue
        except Exception as e:  # noqa: BLE001
            err_detail = str(e)
            continue

    if status is None:
        print(json.dumps({
            "ok": False, "reachable": False, "authOk": False,
            "detail": f"연결 실패: {err_detail or '알 수 없는 오류'}",
            "sentHeaderNames": sorted(headers.keys()),
        }, ensure_ascii=False))
        return 1

    auth_ok, detail = classify(status)
    result = {
        "ok": True,
        "reachable": True,
        "status": status,
        "authOk": auth_ok,
        "detail": detail,
        "sentHeaderNames": sorted(headers.keys()),  # NAMES only, never values
    }
    if elapsed is not None:
        result["elapsedMs"] = elapsed
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
