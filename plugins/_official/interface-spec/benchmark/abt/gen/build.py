#!/usr/bin/env python3
"""Build the synthetic ABT repository (v1 baseline + v2 sprint commit) and the ground truth.

  python3 build.py <out-dir>
Writes <out-dir>/abt-platform (git repo, two commits) and <out-dir>/truth/*.json.
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
import domain  # noqa: E402
import emit  # noqa: E402
import mutate  # noqa: E402
from dsl import endpoints_truth  # noqa: E402


def write_files(root: Path, files: dict[str, str]) -> tuple[int, int, int]:
    added = changed = removed = 0
    existing = {str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() and '.git' not in p.parts}
    for rel, text in files.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        if p.exists():
            if p.read_text(encoding='utf-8') != text:
                p.write_text(text, encoding='utf-8')
                changed += 1
        else:
            p.write_text(text, encoding='utf-8')
            added += 1
    for rel in existing - set(files):
        (root / rel).unlink()
        removed += 1
    return added, changed, removed


def git(root: Path, *args: str) -> str:
    env = {**os.environ, 'GIT_AUTHOR_NAME': 'ABT Team', 'GIT_AUTHOR_EMAIL': 'abt@example.invalid',
           'GIT_COMMITTER_NAME': 'ABT Team', 'GIT_COMMITTER_EMAIL': 'abt@example.invalid'}
    return subprocess.run(['git', *args], cwd=root, env=env, check=True, capture_output=True, text=True).stdout.strip()


def main(out: str) -> None:
    outp = Path(out)
    repo = outp / 'abt-platform'
    truth_dir = outp / 'truth'
    if repo.exists():
        shutil.rmtree(repo)
    repo.mkdir(parents=True)
    truth_dir.mkdir(parents=True, exist_ok=True)

    m1 = domain.build_v1()
    f1 = emit.emit_all(m1)
    write_files(repo, f1)
    git(repo, 'init', '-q', '-b', 'main')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'baseline: ABT platform release 1.0')
    base = git(repo, 'rev-parse', 'HEAD')

    m2, entries = mutate.attributed_truth(m1)
    f2 = emit.emit_all(m2)
    a, c, r = write_files(repo, f2)
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'sprint 24: fare/payment/settlement changes')
    head = git(repo, 'rev-parse', 'HEAD')

    t1, t2 = endpoints_truth(m1), endpoints_truth(m2)
    (truth_dir / 'truth_v1.json').write_text(json.dumps(t1, ensure_ascii=False, indent=1), encoding='utf-8')
    (truth_dir / 'truth_v2.json').write_text(json.dumps(t2, ensure_ascii=False, indent=1), encoding='utf-8')
    (truth_dir / 'truth_changes.json').write_text(json.dumps(entries, ensure_ascii=False, indent=1), encoding='utf-8')
    (truth_dir / 'mutations.json').write_text(json.dumps([{'id': i, 'description': d} for i, d, _ in mutate.MUTATIONS], ensure_ascii=False, indent=1), encoding='utf-8')
    (truth_dir / 'dto_names.json').write_text(json.dumps(sorted(set(m1.dtos) | set(m2.dtos))), encoding='utf-8')
    java = [p for p in repo.rglob('*.java')]
    loc = sum(len(p.read_text(encoding='utf-8').splitlines()) for p in java)
    stat = {
        'base': base, 'head': head, 'files_v1': len(f1), 'files_v2': len(f2), 'java_files_v2': len(java), 'java_loc_v2': loc,
        'diff_files_added': a, 'diff_files_changed': c, 'diff_files_removed': r,
        'routes_v1': len(t1), 'routes_v2': len(t2), 'truth_changes': len(entries),
    }
    (truth_dir / 'stats.json').write_text(json.dumps(stat, indent=1), encoding='utf-8')
    print(json.dumps(stat, indent=1))


if __name__ == '__main__':
    main(sys.argv[1])
