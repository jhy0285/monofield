#!/usr/bin/env python3
"""Score a scanned interface spec against the official RealWorld OpenAPI document (an answer key written independently
of the Spring implementation).

  python3 compare_openapi.py <openapi.yml> <scanned.json> [--detail]
"""
import json
import re
import sys

import yaml


def nr(method: str, path: str) -> str:
    path = re.sub(r"\{[^}]*\}", "{}", path.strip()).rstrip("/") or "/"
    return f"{method.upper()} {path}"


def resolve(spec, node, seen=()):
    while isinstance(node, dict) and "$ref" in node:
        ref = node["$ref"]
        if ref in seen:
            return {}
        seen = seen + (ref,)
        cur = spec
        for part in ref.lstrip("#/").split("/"):
            cur = cur[part]
        node = cur
    return node


def leaves(spec, schema, prefix="", seen=()):
    schema = resolve(spec, schema, seen)
    if not isinstance(schema, dict):
        return set()
    if schema.get("type") == "array" or "items" in schema:
        return leaves(spec, schema.get("items", {}), prefix, seen) or ({prefix} if prefix else set())
    props = schema.get("properties")
    if props:
        out = set()
        for name, sub in props.items():
            path = f"{prefix}.{name}" if prefix else name
            sub_leaves = leaves(spec, sub, path, seen)
            out |= sub_leaves or {path}
        return out
    for key in ("allOf", "oneOf", "anyOf"):
        if key in schema:
            out = set()
            for sub in schema[key]:
                out |= leaves(spec, sub, prefix, seen)
            return out
    return {prefix} if prefix else set()


def spec_ops(spec):
    ops = {}
    for path, item in spec["paths"].items():
        common = item.get("parameters", [])
        for method, op in item.items():
            if method not in ("get", "post", "put", "patch", "delete"):
                continue
            params = set()
            for p in common + op.get("parameters", []):
                p = resolve(spec, p)
                if p.get("in") in ("query", "path"):
                    params.add(p["name"])
            body = set()
            if "requestBody" in op:
                rb = resolve(spec, op["requestBody"])
                for media in rb.get("content", {}).values():
                    body |= leaves(spec, media.get("schema", {}))
            resp = set()
            for status in ("200", "201"):
                if status in op.get("responses", {}):
                    r = resolve(spec, op["responses"][status])
                    for media in r.get("content", {}).values():
                        resp |= leaves(spec, media.get("schema", {}))
            security = op.get("security", spec.get("security", []))
            auth = bool(security) and not any(not s for s in security)
            ops[nr(method, path)] = {"request": params | body, "response": resp, "auth": auth}
    return ops


def norm_field(path: str) -> str:
    return re.sub(r"\[\d*\]", "", path or "").strip(".")


def leaves_only(paths: set) -> set:
    """The spec counts leaf fields; a scanned parent row (`user` above `user.email`) is not a field of its own."""
    return {p for p in paths if not any(o.startswith(p + ".") for o in paths)}


def scanned_ops(doc):
    ops = {}
    for e in doc["endpoints"]:
        methods = e["method"].split("/")
        req = leaves_only({norm_field(f.get("path") or f["nameEn"]) for f in e["requestFields"] if f.get("note") != "request header"})
        res = leaves_only({norm_field(f.get("path") or f["nameEn"]) for f in e["responseFields"]})
        auth = None if (e.get("auth") or {}).get("type") == "undecided" else bool(e.get("authRequired"))
        for m in methods:
            ops[nr(m, e["path"])] = {"request": req, "response": res, "auth": auth, "raw_method": e["method"]}
    return ops


def prf(truth: set, got: set):
    tp = len(truth & got)
    return tp, len(got - truth), len(truth - got)


def main():
    spec = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))
    doc = json.load(open(sys.argv[2], encoding="utf-8"))
    detail = "--detail" in sys.argv
    truth, got = spec_ops(spec), scanned_ops(doc)
    exact_routes = {nr(e["method"], e["path"]) for e in doc["endpoints"]}
    totals = {"request": [0, 0, 0], "response": [0, 0, 0]}
    auth = {"correct": 0, "wrong": 0, "undecided": 0}
    for key, t in truth.items():
        g = got.get(key)
        if not g:
            if detail:
                print("MISSING", key)
            continue
        for part in ("request", "response"):
            tp, fp, fn = prf(t[part], g[part])
            totals[part][0] += tp
            totals[part][1] += fp
            totals[part][2] += fn
            if detail and (fp or fn):
                print(f"{key} {part}: missing {sorted(t[part] - g[part])} extra {sorted(g[part] - t[part])}")
        if g["auth"] is None:
            auth["undecided"] += 1
        elif g["auth"] == t["auth"]:
            auth["correct"] += 1
        else:
            auth["wrong"] += 1
            if detail:
                print(f"{key} auth: truth {t['auth']} got {g['auth']}")
    report = {
        "routes_in_spec": len(truth),
        "routes_found_exact": len(set(truth) & exact_routes),
        "routes_found_any_method": len(set(truth) & set(got)),
        "routes_extra": sorted(exact_routes - set(truth)),
        "auth": auth,
    }
    for part, (tp, fp, fn) in totals.items():
        report[part] = {"truth": tp + fn, "found": tp, "missing": fn, "extra": fp,
                        "recall": round(tp / (tp + fn), 3) if tp + fn else None,
                        "precision": round(tp / (tp + fp), 3) if tp + fp else None}
    print(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
