"""open-design.json `od.context.assets` must stage every script the agent can run.

The daemon stages exactly the paths listed under `od.context.assets` (see
`buildAssetRefs` in apps/daemon/src/plugins/apply.ts) and nothing else, so a
script that SKILL.md tells the agent to run, or that a staged script imports,
but that is missing from the list simply does not exist in the run workspace.
"""

from __future__ import annotations

import ast
import json
import re
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
PLUGIN_DIR = SCRIPTS_DIR.parent
TESTS_DIR = SCRIPTS_DIR / "tests"


def _rel(path: Path) -> str:
    return path.relative_to(PLUGIN_DIR).as_posix()


def _manifest_assets() -> list[str]:
    manifest = json.loads((PLUGIN_DIR / "open-design.json").read_text(encoding="utf-8"))
    assets = manifest["od"]["context"]["assets"]
    return [asset[2:] if asset.startswith("./") else asset for asset in assets]


def _skill_script_tokens() -> list[str]:
    text = (PLUGIN_DIR / "SKILL.md").read_text(encoding="utf-8")
    return re.findall(r"[\w/]+\.py", text)


def _skill_scripts() -> set[Path]:
    """Top-level scripts SKILL.md names, either as `scripts/x.py` or a bare `x.py`."""
    found: set[Path] = set()
    for token in _skill_script_tokens():
        candidate = SCRIPTS_DIR / token.removeprefix("scripts/")
        if candidate.is_file() and TESTS_DIR not in candidate.parents:
            found.add(candidate)
    return found


def _module_files(dotted: str) -> list[Path]:
    """Files Python executes to import `dotted`: each package `__init__.py`, then the module."""
    files: list[Path] = []
    parts = dotted.split(".")
    for end in range(1, len(parts) + 1):
        base = SCRIPTS_DIR.joinpath(*parts[:end])
        if (base / "__init__.py").is_file():
            files.append(base / "__init__.py")
        elif base.with_suffix(".py").is_file():
            files.append(base.with_suffix(".py"))
            break
        else:
            break
    return files


def _local_imports(path: Path) -> set[Path]:
    """Scripts-tree files `path` imports, at any nesting depth (try/except and functions too)."""
    package = path.parent.relative_to(SCRIPTS_DIR).parts
    found: set[Path] = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"), filename=str(path))):
        if isinstance(node, ast.Import):
            for alias in node.names:
                found.update(_module_files(alias.name))
        elif isinstance(node, ast.ImportFrom):
            anchor = package[: len(package) - (node.level - 1)] if node.level else ()
            module = ".".join([*anchor, *(node.module.split(".") if node.module else [])])
            if module:
                found.update(_module_files(module))
            for alias in node.names:
                found.update(_module_files(f"{module}.{alias.name}" if module else alias.name))
    return found


def _required_files() -> dict[Path, Path]:
    """Every file the staged entry scripts need, mapped to one file that needs it."""
    staged_entries = {
        PLUGIN_DIR / asset for asset in _manifest_assets()
        if (PLUGIN_DIR / asset).parent == SCRIPTS_DIR and asset.endswith(".py")
    }
    entries = staged_entries | _skill_scripts()
    needed_by: dict[Path, Path] = {entry: entry for entry in entries}
    queue = sorted(entries)
    while queue:
        current = queue.pop()
        for dependency in _local_imports(current):
            if dependency not in needed_by:
                needed_by[dependency] = current
                queue.append(dependency)
    return needed_by


class ManifestAssetsTest(unittest.TestCase):
    def test_every_runtime_script_is_staged(self) -> None:
        needed_by = _required_files()
        # The walk must actually reach the shared package, or this test guards nothing.
        self.assertTrue(any(_rel(path).startswith("scripts/tools/") for path in needed_by))

        staged = set(_manifest_assets())
        missing = [
            f"{_rel(path)} ({'named in SKILL.md' if needed_by[path] == path else 'imported by ' + _rel(needed_by[path])})"
            for path in sorted(needed_by)
            if _rel(path) not in staged
        ]
        self.assertEqual([], missing, "add to od.context.assets in open-design.json")

    def test_staged_assets_exist_and_exclude_tests(self) -> None:
        assets = _manifest_assets()
        self.assertEqual(len(assets), len(set(assets)), "duplicate entries in od.context.assets")
        for asset in assets:
            with self.subTest(asset=asset):
                self.assertNotIn("..", Path(asset).parts)
                self.assertTrue((PLUGIN_DIR / asset).is_file(), f"{asset} does not exist")
                self.assertNotIn("tests", Path(asset).parts, "tests must not be staged")
                self.assertNotIn("__pycache__", Path(asset).parts)
                self.assertFalse(asset.endswith(".pyc"))

    def test_skill_only_names_scripts_that_exist(self) -> None:
        for token in _skill_script_tokens():
            if token.startswith("scripts/"):
                with self.subTest(script=token):
                    self.assertTrue((PLUGIN_DIR / token).is_file(), f"SKILL.md names {token}, which is not shipped")


if __name__ == "__main__":
    unittest.main()
