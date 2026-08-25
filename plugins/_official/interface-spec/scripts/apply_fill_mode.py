"""Apply the fixed interface-spec fill-mode answers without guessing domains."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


def normalise(value: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def endpoint_domain(endpoint: dict[str, Any]) -> str:
    for key in ("moduleName", "serviceName", "domain"):
        value = str(endpoint.get(key) or "").strip()
        if value:
            return value
    path = str(endpoint.get("path") or "").strip("/")
    return path.split("/", 1)[0] if path else ""


def apply_fill_mode(
    document: dict[str, Any],
    mode: str,
    business_code: str = "",
    owner: str = "",
    note: str = "",
    domain_map: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], list[str]]:
    endpoints = document.get("endpoints")
    if not isinstance(endpoints, list):
        raise ValueError("interface-spec document must contain an endpoints array")
    mapping = {normalise(key): value for key, value in (domain_map or {}).items()}
    unmatched: list[str] = []
    for endpoint in endpoints:
        if not isinstance(endpoint, dict):
            continue
        if mode == "blank":
            values = {"businessCode": "", "owner": "", "note": ""}
        elif mode == "global":
            values = {"businessCode": business_code, "owner": owner, "note": note}
        elif mode == "domain-mapping":
            domain = endpoint_domain(endpoint)
            raw = mapping.get(normalise(domain))
            if not isinstance(raw, dict):
                values = {"businessCode": "", "owner": "", "note": ""}
                if domain and domain not in unmatched:
                    unmatched.append(domain)
            else:
                values = {
                    "businessCode": str(raw.get("businessCode") or ""),
                    "owner": str(raw.get("owner") or ""),
                    "note": str(raw.get("note") or ""),
                }
        else:
            raise ValueError(f"unsupported fill mode: {mode}")
        endpoint.update(values)
    return document, unmatched


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--mode", choices=("blank", "global", "domain-mapping"), required=True)
    parser.add_argument("--business-code", default="")
    parser.add_argument("--owner", default="")
    parser.add_argument("--note", default="")
    parser.add_argument("--domain-map", type=Path)
    args = parser.parse_args()
    document = json.loads(args.input.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise SystemExit("interface-spec JSON must be an object")
    domain_map: dict[str, Any] = {}
    if args.domain_map:
        loaded = json.loads(args.domain_map.read_text(encoding="utf-8"))
        if not isinstance(loaded, dict):
            raise SystemExit("--domain-map must contain an object keyed by domain")
        domain_map = loaded
    result, unmatched = apply_fill_mode(
        document,
        args.mode,
        args.business_code,
        args.owner,
        args.note,
        domain_map,
    )
    output = args.out or args.input
    output.write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({"out": str(output), "unmatchedDomains": unmatched}, ensure_ascii=False))


if __name__ == "__main__":
    main()
