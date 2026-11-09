#!/usr/bin/env python3
"""MonoField arm (deterministic part): scan v1 and v2 with the shipped Spring scanner, compare with the shipped
compatibility classifier, and write normalised specs/changes for scoring.

  python3 mf_arm.py <repo> <truth-dir> <out-dir> <base-sha> <head-sha>
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import score  # noqa: E402

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[4]
SCAN = str(REPO / 'plugins/_official/interface-spec/scripts/scan_spring.py')


def run(cmd, cwd=None):
    return subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, text=True)


def scan(repo: Path, sha: str, out: Path) -> float:
    run(['git', 'checkout', '-q', sha], cwd=repo)
    t = time.time()
    run(['python3', SCAN, '--codebase-path', str(repo), '--codebase-name', 'abt', '--out', str(out)])
    return time.time() - t


def normalise(raw: dict, dto_names: set[str]) -> dict:
    eps = []
    for e in raw['endpoints']:
        auth = e.get('auth', {}) or {}
        a = None if auth.get('type') == 'undecided' else bool(e.get('authRequired'))
        req = [{'path': f.get('path') or f['nameEn'], 'cat': score.cat_of(f.get('dataType', ''), dto_names), 'req': f.get('required') == 'Y'} for f in e.get('requestFields', [])]
        res = [{'path': f.get('path') or f['nameEn'], 'cat': score.cat_of(f.get('dataType', ''), dto_names)} for f in e.get('responseFields', [])]
        eps.append({'route': score.norm_route(e['method'], e['path']), 'handler': e.get('handlerName'), 'auth': a, 'request': req, 'response': res, 'raw_path': e['path']})
    return {'endpoints': eps}


def normalise_changes(report: dict, v1: dict, v2: dict) -> list[dict]:
    h1 = {score.norm_route(e['method'], e['path']): e.get('handlerName') for e in v1['endpoints']}
    h2 = {score.norm_route(e['method'], e['path']): e.get('handlerName') for e in v2['endpoints']}
    out = []
    for c in report['changes']:
        route = c['route']
        method, _, path = route.partition(' ')
        nr = score.norm_route(method, path)
        handler = (h1 if c['code'] == 'endpoint-removed' else h2).get(nr) or h1.get(nr) or h2.get(nr)
        out.append({'route': nr, 'handler': handler, 'location': c.get('location') or 'endpoint', 'field': c.get('field'),
                    'kind': c['code'], 'level': c['level']})
    return out


def main(repo, truth_dir, out_dir, base, head):
    repo, truth_dir, out_dir = Path(repo), Path(truth_dir), Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    dto_names = set(json.loads((truth_dir / 'dto_names.json').read_text()))
    t1 = scan(repo, base, out_dir / 'mf_v1.raw.json')
    t2 = scan(repo, head, out_dir / 'mf_v2.raw.json')
    v1 = json.loads((out_dir / 'mf_v1.raw.json').read_text())
    v2 = json.loads((out_dir / 'mf_v2.raw.json').read_text())
    (out_dir / 'mf_v1.norm.json').write_text(json.dumps(normalise(v1, dto_names), ensure_ascii=False, indent=1))
    (out_dir / 'mf_v2.norm.json').write_text(json.dumps(normalise(v2, dto_names), ensure_ascii=False, indent=1))
    r = run(['pnpm', 'exec', 'tsx', str(REPO / 'e2e/scripts/abt-compare.ts'), str((out_dir / 'mf_v1.raw.json').resolve()), str((out_dir / 'mf_v2.raw.json').resolve()), str((out_dir / 'mf_compat.json').resolve())], cwd=REPO)
    report = json.loads((out_dir / 'mf_compat.json').read_text())
    changes = normalise_changes(report, v1, v2)
    (out_dir / 'mf_changes.norm.json').write_text(json.dumps(changes, ensure_ascii=False, indent=1))
    (out_dir / 'mf_timing.json').write_text(json.dumps({'scan_v1_s': round(t1, 2), 'scan_v2_s': round(t2, 2)}))
    print('scan seconds', round(t1, 2), round(t2, 2), '| compat', r.stdout.strip())


if __name__ == '__main__':
    main(*sys.argv[1:6])
