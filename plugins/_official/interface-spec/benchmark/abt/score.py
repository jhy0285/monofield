#!/usr/bin/env python3
"""Scoring for the ABT comparison. Reads normalised specs/changes and the ground truth.

Normalised spec:   {"endpoints": [{"route": "GET /a/{}", "handler": str|None, "auth": true|false|null,
                                    "request": [{"path","cat","req"}], "response": [{"path","cat"}]}]}
Normalised changes: [{"route","location","field","kind","level"}]
"""
from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ENVELOPE_ROOT = {'content', 'data', 'result', 'code', 'message', 'traceid', 'page', 'size', 'totalelements', 'totalpages', 'resultcode', 'resultmsg', 'success'}
WRAP_PREFIX = re.compile(r'^(data|result|content|items|body|request|response)(\[\])?\.', re.I)


def norm_route(method: str, path: str) -> str:
    path = re.sub(r'\{([^}:]+)(:[^}]*)?\}', '{}', (path or '').strip())
    path = re.sub(r':[A-Za-z_]\w*', '{}', path)
    path = re.sub(r'/+$', '', path) or '/'
    return f'{(method or "").strip().upper()} {path}'


def nr(route: str) -> str:
    m, _, p = (route or '').partition(' ')
    return norm_route(m, p)


def norm_field(p: str, response: bool = False) -> str:
    p = (p or '').strip().replace('[0]', '[]').replace('[*]', '[]')
    p = re.sub(r'\[\]', '', p)
    if response:
        # the generic envelope is not part of the payload; both arms are normalised the same way
        while True:
            q = WRAP_PREFIX.sub('', p, count=1) if p.lower().startswith(('data.', 'result.', 'content.', 'body.', 'response.')) else p
            if q == p:
                break
            p = q
        if p.lower() in ENVELOPE_ROOT:
            return ''
    else:
        p = re.sub(r'^(body|request|query|path|header)\.', '', p, flags=re.I)
    return p.lower()


def cat_of(t: str, dto_names: set[str]) -> str:
    t = (t or '').strip()
    low = t.lower()
    if low in ('integer', 'long', 'int', 'short', 'integer(int64)', 'int32', 'int64'):
        return 'integer'
    if low in ('number', 'bigdecimal', 'double', 'float', 'decimal'):
        return 'number'
    if low in ('boolean', 'bool'):
        return 'boolean'
    if low in ('string', 'date', 'datetime', 'timestamp', 'uuid') or low.startswith(('local', 'offset')):
        return 'string'
    if low in ('array', 'list') or low.startswith(('list<', 'set<', 'collection<')) or low.endswith('[]'):
        return 'array'
    if low in ('object', 'map') or low.startswith('map<'):
        return 'object'
    if t in dto_names:
        return 'object'
    return 'string'


def prf(tp: int, fp: int, fn: int) -> dict:
    p = tp / (tp + fp) if tp + fp else 1.0
    r = tp / (tp + fn) if tp + fn else 1.0
    return {'tp': tp, 'fp': fp, 'fn': fn, 'precision': round(p, 4), 'recall': round(r, 4)}


def score_spec(truth: list[dict], spec: dict) -> dict:
    t_by = {nr(x['route']): x for x in truth}
    s_by = {}
    dup = 0
    for e in spec['endpoints']:
        if e['route'] in s_by:
            dup += 1
        s_by[e['route']] = e
    exact = t_by.keys() & s_by.keys()
    # lenient: same HTTP method + handler name (the route text may be wrong, e.g. an unresolved constant)
    t_handler = defaultdict(list)
    for x in truth:
        t_handler[(x['route'].split(' ', 1)[0], x.get('handler'))].append(nr(x['route']))
    lenient = set()
    for r, e in s_by.items():
        if r in exact:
            continue
        key = (r.split(' ', 1)[0], e.get('handler'))
        cands = [c for c in t_handler.get(key, []) if c not in exact and c not in lenient]
        if e.get('handler') and len(cands) == 1:
            lenient.add(cands[0])
    out = {
        'routes_truth': len(t_by), 'routes_reported': len(s_by),
        'routes_strict': prf(len(exact), len(s_by.keys() - t_by.keys()), len(t_by.keys() - s_by.keys())),
        'routes_lenient_matched': len(exact) + len(lenient), 'duplicate_routes': dup,
    }
    rq = [0, 0, 0]; rs = [0, 0, 0]
    req_ok = req_total = type_ok = type_total = 0
    auth = {'correct': 0, 'wrong': 0, 'undecided': 0}
    hidden_fp = 0
    for r in exact:
        t, s = t_by[r], s_by[r]
        for loc, acc in (('request', rq), ('response', rs)):
            tf = {norm_field(x['path'], loc == 'response'): x for x in t[loc]}
            tf.pop('', None)
            sf = {}
            for x in s[loc]:
                k = norm_field(x['path'], loc == 'response')
                if k:
                    sf[k] = x
            tp = tf.keys() & sf.keys()
            acc[0] += len(tp); acc[1] += len(sf.keys() - tf.keys()); acc[2] += len(tf.keys() - sf.keys())
            if loc == 'request':
                for k in tp:
                    req_total += 1
                    if tf[k]['req'] == bool(sf[k].get('req')):
                        req_ok += 1
            for k in tp:
                type_total += 1
                if tf[k]['cat'] == sf[k].get('cat'):
                    type_ok += 1
        ta = t['auth']['required']
        sa = s.get('auth')
        if sa is None:
            auth['undecided'] += 1
        elif sa == ta:
            auth['correct'] += 1
        else:
            auth['wrong'] += 1
    out['request_fields'] = prf(*rq)
    out['response_fields'] = prf(*rs)
    out['required_flag_accuracy'] = round(req_ok / req_total, 4) if req_total else None
    out['type_accuracy'] = round(type_ok / type_total, 4) if type_total else None
    out['auth'] = auth
    return out


def key_of(c: dict) -> tuple:
    return (nr(c['route']), c['location'], norm_field(c.get('field') or '', c['location'] == 'response'))


FAMILY = {
    'endpoint-removed': 'endpoint-removed', 'endpoint-added': 'endpoint-added',
    'auth-required-added': 'auth', 'auth-required-removed': 'auth', 'auth-scope-changed': 'auth', 'auth-changed': 'auth',
    'request-field-added-required': 'added', 'request-field-added-optional': 'added', 'request-field-added-unresolved': 'added', 'response-field-added': 'added', 'field-added': 'added',
    'request-field-removed': 'removed', 'response-field-removed': 'removed', 'field-removed': 'removed',
    'field-type-changed': 'type', 'request-field-became-required': 'required', 'request-field-became-optional': 'required', 'field-required-changed': 'required',
    'response-field-became-optional': 'required', 'request-field-max-size-reduced': 'constraint', 'field-constraint-changed': 'constraint',
}


def resolve_routes(reported: list[dict], truth_v1: list[dict], truth_v2: list[dict]) -> list[dict]:
    """Lenient mode: replace a reported route with the true route of the same HTTP method + handler (the reader can
    see the handler name next to a wrong path and fix the path by hand)."""
    t1 = {(x['route'].split(' ', 1)[0], x['handler']): x['route'] for x in truth_v1}
    t2 = {(x['route'].split(' ', 1)[0], x['handler']): x['route'] for x in truth_v2}
    out = []
    for c in reported:
        d = dict(c)
        h = c.get('handler')
        if h:
            method = c['route'].split(' ', 1)[0]
            table = t1 if c.get('kind') == 'endpoint-removed' else t2
            hit = table.get((method, h)) or (t2 if table is t1 else t1).get((method, h))
            if hit:
                d['route'] = hit
        out.append(d)
    return out


def score_changes(truth_changes: list[dict], reported: list[dict], strict_route_only: bool = True) -> dict:
    in_vocab = [t for t in truth_changes if t['vocab'] and not t.get('secondary')]
    secondary = {key_of(t) for t in truth_changes if t.get('secondary')} | {key_of({**t, 'route': t['old_route']}) for t in truth_changes if t.get('secondary') and t.get('old_route')}
    t_keys: dict[tuple, list[dict]] = defaultdict(list)
    for t in in_vocab:
        t_keys[key_of(t)].append(t)
    r_keys: dict[tuple, list[dict]] = defaultdict(list)
    for c in reported:
        r_keys[key_of(c)].append(c)
    tp_keys = t_keys.keys() & r_keys.keys()
    per_mut = defaultdict(lambda: [0, 0])
    level_ok = level_total = 0
    family_ok = family_total = 0
    level_matrix = defaultdict(int)
    for k, ts in t_keys.items():
        for t in ts:
            for mid in t['mutation'].split('+'):
                per_mut[mid][1] += 1
                if k in r_keys:
                    per_mut[mid][0] += 1
    for k in tp_keys:
        t = t_keys[k][0]
        # prefer a reported entry of the same family, else the first
        rs = r_keys[k]
        r = next((x for x in rs if FAMILY.get(x.get('kind'), x.get('kind')) == FAMILY.get(t['kind'], t['kind'])), rs[0])
        level_total += 1
        level_matrix[(t['level'], r.get('level'))] += 1
        if r.get('level') == t['level']:
            level_ok += 1
        family_total += 1
        if FAMILY.get(r.get('kind'), r.get('kind')) == FAMILY.get(t['kind'], t['kind']):
            family_ok += 1
    OOV = re.compile(r'default|enum|scope|authorit|access-rule|기본값|열거|범위|권한', re.I)
    def oov(c):
        # A report about an enum value, a default or an authority answers an out-of-vocabulary truth item (B1-B4),
        # judged separately; neither arm is penalised for it, whether it says so in its kind or its reason.
        return c.get('kind') == 'other' or bool(OOV.search(f"{c.get('kind') or ''} {c.get('reason') or ''}"))
    ignored = {k for k, cs in r_keys.items() if k in secondary or all(oov(c) for c in cs)}
    fp_keys = r_keys.keys() - t_keys.keys() - ignored
    out = {
        'truth_in_vocab': len(t_keys), 'reported': len(r_keys), 'reported_not_penalised': len(ignored & (r_keys.keys() - t_keys.keys())),
        'detection': prf(len(tp_keys), len(fp_keys), len(t_keys.keys() - r_keys.keys())),
        'level_accuracy_on_detected': round(level_ok / level_total, 4) if level_total else None,
        'kind_accuracy_on_detected': round(family_ok / family_total, 4) if family_total else None,
        'level_matrix': {f'{a}->{b}': n for (a, b), n in sorted(level_matrix.items(), key=lambda z: str(z))},
        'per_mutation': {m: {'detected': d, 'total': n, 'recall': round(d / n, 3)} for m, (d, n) in sorted(per_mut.items())},
        'false_positive_samples': [list(k) for k in sorted(fp_keys)[:25]],
        'false_positive_count': len(fp_keys),
    }
    return out


def load(path: str):
    return json.loads(Path(path).read_text(encoding='utf-8'))


if __name__ == '__main__':
    truth = load(sys.argv[1])
    spec = load(sys.argv[2])
    print(json.dumps(score_spec(truth, spec), ensure_ascii=False, indent=1))
