#!/usr/bin/env python3
"""Score every arm that has produced output and print one JSON report.  python3 eval_all.py > report.json"""
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import score  # noqa: E402

W = HERE / 'work'
T = W / 'truth'
truth_v1 = json.loads((T / 'truth_v1.json').read_text())
truth_v2 = json.loads((T / 'truth_v2.json').read_text())
truth_changes = json.loads((T / 'truth_changes.json').read_text())
dto_names = set(json.loads((T / 'dto_names.json').read_text()))
stats = json.loads((T / 'stats.json').read_text())


def norm_plain_spec(raw: dict) -> dict:
    eps = []
    for e in raw.get('endpoints', []):
        a = e.get('auth') or {}
        req = e.get('auth', {}).get('required') if isinstance(a, dict) else a
        eps.append({
            'route': score.norm_route(e.get('method', ''), e.get('path', '')), 'handler': e.get('handler'),
            'auth': req if isinstance(req, bool) else None,
            'request': [{'path': f.get('path', ''), 'cat': score.cat_of(str(f.get('type', '')), dto_names), 'req': bool(f.get('required'))} for f in e.get('request', [])],
            'response': [{'path': f.get('path', ''), 'cat': score.cat_of(str(f.get('type', '')), dto_names)} for f in e.get('response', [])],
        })
    return {'endpoints': eps}


def norm_plain_changes(raw) -> list[dict]:
    out = []
    for c in raw if isinstance(raw, list) else raw.get('changes', []):
        route = c.get('route', '')
        m, _, p = route.partition(' ')
        out.append({'route': score.norm_route(m, p), 'location': c.get('location') or 'endpoint', 'field': c.get('field'), 'kind': c.get('kind'),
                    'level': c.get('level'), 'reason': c.get('reason', '')})
    return out


def other_changes_found(changes: list[dict]) -> dict:
    """Out-of-vocabulary truth items (enum value, default, scope) are adjudicated by keywords in what the arm wrote."""
    text = [(json.dumps(c, ensure_ascii=False)).lower() for c in changes]
    has = lambda *words: any(all(w.lower() in t for w in words) for t in text)
    return {
        'B1_scope_blacklist': has('blacklist', 'scope') or has('blacklist/delta', 'admin'),
        'B2_enum_PARTIAL_REFUND': has('partial_refund'),
        'B3_enum_SYSTEM_ERROR': has('system_error'),
        'B4_default_size': has('size', '50') or has('default', 'size'),
    }


def spec_diff_collateral(v1: dict, v2: dict, touched_routes: set[str]) -> dict:
    """Endpoints the truth says did not change but whose own spec changed between the arm's v1 and v2."""
    a = {e['route']: e for e in v1['endpoints']}
    b = {e['route']: e for e in v2['endpoints']}
    def sig(e):
        return (tuple(sorted((score.norm_field(x['path']), x['cat'], x.get('req')) for x in e['request'])),
                tuple(sorted((score.norm_field(x['path'], True), x['cat']) for x in e['response'])), e['auth'])
    touched = 0
    spurious = []
    for r in a.keys() & b.keys():
        if sig(a[r]) != sig(b[r]):
            if r in touched_routes:
                touched += 1
            else:
                spurious.append(r)
    return {'changed_endpoints_total': touched + len(spurious), 'spurious_changes_on_untouched_endpoints': len(spurious), 'spurious_samples': sorted(spurious)[:8]}


def jaccard(sets: list[set]) -> float:
    if not sets:
        return None
    inter = set.intersection(*sets)
    union = set.union(*sets)
    return round(len(inter) / len(union), 4) if union else 1.0


def spec_fieldset(spec: dict) -> set:
    out = set()
    for e in spec['endpoints']:
        out.add(('route', e['route']))
        for x in e['request']:
            out.add(('req', e['route'], score.norm_field(x['path'])))
        for x in e['response']:
            out.add(('res', e['route'], score.norm_field(x['path'], True)))
    return out


def usage(path: Path) -> dict:
    try:
        d = json.loads(path.read_text())
    except Exception:
        return {}
    u = d.get('usage', {})
    return {'cost_usd': d.get('total_cost_usd'), 'duration_s': round((d.get('duration_ms') or 0) / 1000), 'turns': d.get('num_turns'),
            'input_tokens': u.get('input_tokens'), 'output_tokens': u.get('output_tokens'),
            'cache_read': u.get('cache_read_input_tokens'), 'cache_create': u.get('cache_creation_input_tokens'),
            'is_error': d.get('is_error'), 'models': list((d.get('modelUsage') or {}).keys())}


def touched_routes_set() -> set[str]:
    return {score.nr(c['route']) for c in truth_changes if c['route'] != '*'}


def mf_impact() -> dict:
    """MonoField's own file-level impact rule (document-impact.ts matchDocumentImpact) applied to the baseline scan."""
    raw = json.loads((HERE / 'out/mf/mf_v1.raw.json').read_text())
    changed = set(subprocess.run(['git', 'diff', '--name-only', stats['base'], stats['head']], cwd=W / 'abt-platform', capture_output=True, text=True).stdout.split())
    affected = []
    for e in raw['endpoints']:
        refs = {e.get('sourceFile')} | {r['ref'] for r in e.get('evidenceRefs', []) if r.get('kind') == 'code'}
        for f in e.get('requestFields', []) + e.get('responseFields', []):
            refs |= {r['ref'] for r in f.get('evidenceRefs', []) if r.get('kind') == 'code'}
        if refs & changed:
            affected.append(e.get('handlerName'))
    handler_to_route = {x['handler']: x['route'] for x in truth_v2}
    truth_routes = {c['route'] for c in truth_changes if c['vocab'] and c['route'] != '*'}
    truth_handlers = {x['handler'] for x in truth_v2 if x['route'] in truth_routes} | {x['handler'] for x in truth_v1 if x['route'] in truth_routes}
    a = set(affected)
    return {'flagged': len(a), 'truth_endpoints_with_in_vocab_change': len(truth_handlers),
            'flagged_and_truly_changed': len(a & truth_handlers), 'flagged_but_unchanged': len(a - truth_handlers), 'changed_but_not_flagged': len(truth_handlers - a),
            'changed_files': len(changed)}


def mf_impact_rescan() -> dict:
    """MonoField's re-scan impact (document-rescan.ts): the baseline document's endpoints that the scanner's own
    before/after comparison reports a change for, plus routes the code has and the document does not. Route-based."""
    v1_routes = {e['route'] for e in json.loads((HERE / 'out/mf/mf_v1.norm.json').read_text())['endpoints']}
    changes = json.loads((HERE / 'out/mf/mf_changes.norm.json').read_text())
    changed = {c['route'] for c in changes}
    flagged = v1_routes & changed
    new = {c['route'] for c in changes if c['kind'] == 'endpoint-added'} - v1_routes
    truth = {score.nr(c['route']) for c in truth_changes if c['vocab'] and c['route'] != '*'}
    truth_documented = truth & v1_routes
    truth_new = {score.nr(x['route']) for x in truth_v2} & truth - v1_routes
    return {'flagged': len(flagged), 'truth_documented_routes_with_in_vocab_change': len(truth_documented),
            'flagged_and_truly_changed': len(flagged & truth), 'flagged_but_unchanged': sorted(flagged - truth),
            'changed_but_not_flagged': sorted(truth_documented - flagged),
            'new_routes': len(new), 'new_routes_true': len(new & truth_new), 'new_routes_missed': sorted(truth_new - new)}


def main():
    report = {'experiment': stats}
    # ---- MonoField, deterministic scan + shipped classifier
    mf_v1 = json.loads((HERE / 'out/mf/mf_v1.norm.json').read_text())
    mf_v2 = json.loads((HERE / 'out/mf/mf_v2.norm.json').read_text())
    mf_ch = json.loads((HERE / 'out/mf/mf_changes.norm.json').read_text())
    lenient = score.resolve_routes(mf_ch, truth_v1, truth_v2)
    report['monofield'] = {
        'timing': json.loads((HERE / 'out/mf/mf_timing.json').read_text()),
        'phase1_v1': score.score_spec(truth_v1, mf_v1), 'phase1_v2': score.score_spec(truth_v2, mf_v2),
        'changes_strict': score.score_changes(truth_changes, mf_ch), 'changes_lenient': score.score_changes(truth_changes, lenient),
        'impact': mf_impact(), 'impact_rescan': mf_impact_rescan(),
        # Same keyword adjudication as the plain runs. Before 2026-11-11 the interface-spec schema had no enum values,
        # defaults or authorities, so these were all False by construction.
        'out_of_vocab': other_changes_found(mf_ch),
    }
    # ---- plain Claude Code runs
    runs = []
    for rd in sorted((HERE / 'plain').glob('run*/')):
        r = {'run': rd.name, 'prompt': 'naive' if rd.name.startswith('runn') else 'expert'}
        for ph in ('1', '2'):
            r[f'usage_p{ph}'] = usage(rd / f'p{ph}.result.json')
        if (rd / 'spec_v1.json').exists():
            v1 = norm_plain_spec(json.loads((rd / 'spec_v1.json').read_text()))
            r['phase1_v1'] = score.score_spec(truth_v1, v1)
            r['_v1'] = v1
        if (rd / 'spec_v2.json').exists() and (rd / 'changes.json').exists():
            v2 = norm_plain_spec(json.loads((rd / 'spec_v2.json').read_text()))
            ch = norm_plain_changes(json.loads((rd / 'changes.json').read_text()))
            r['phase1_v2'] = score.score_spec(truth_v2, v2)
            r['changes'] = score.score_changes(truth_changes, ch)
            r['out_of_vocab'] = other_changes_found(ch)
            r['reported_changes'] = len(ch)
            if '_v1' in r:
                r['collateral'] = spec_diff_collateral(r['_v1'], v2, touched_routes_set())
            r['_v2'] = v2
            r['_ch'] = ch
        runs.append(r)
    report['plain_runs'] = [{k: v for k, v in r.items() if not k.startswith('_')} for r in runs]
    done = [r for r in runs if '_v1' in r]
    if len(done) >= 2:
        report['plain_consistency'] = {
            'phase1_fieldset_jaccard': jaccard([spec_fieldset(r['_v1']) for r in done]),
            'changes_jaccard': jaccard([{(c['route'], c['location'], score.norm_field(c.get('field') or '', c['location'] == 'response')) for c in r['_ch']} for r in done if '_ch' in r]),
        }
    print(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
