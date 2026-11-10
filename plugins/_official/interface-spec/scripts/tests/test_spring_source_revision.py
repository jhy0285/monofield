"""The scanner records the Git commit it read, so `docs impact` still compares with it after later commits."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
CONTROLLER = textwrap.dedent("""
    package x;
    @RestController
    @RequestMapping("/api")
    public class PingController {
        @GetMapping("/ping")
        public String ping() { return null; }
    }
""")


@unittest.skipIf(shutil.which("git") is None, "git is not installed")
class SourceRevisionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "app"
        source = self.root / "src/main/java/x/PingController.java"
        source.parent.mkdir(parents=True)
        source.write_text(CONTROLLER, encoding="utf-8")
        (self.root / "README.md").write_text("# app\n", encoding="utf-8")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def git(self, *args: str) -> str:
        return subprocess.run(["git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid", *args],
                              cwd=self.root, check=True, capture_output=True, text=True).stdout.strip()

    def commit(self) -> str:
        self.git("init", "-q")
        self.git("add", "-A")
        self.git("commit", "-q", "--no-verify", "-m", "baseline")
        return self.git("rev-parse", "HEAD")

    def source(self) -> dict:
        out = Path(self.temp.name) / "spec.json"
        subprocess.run([sys.executable, str(SCRIPTS_DIR / "scan_spring.py"), "--codebase-path", str(self.root), "--out", str(out)],
                       check=True, capture_output=True, text=True)
        return json.loads(out.read_text(encoding="utf-8"))["source"]

    def test_committed_sources_record_the_commit(self) -> None:
        head = self.commit()
        self.assertEqual(self.source().get("revision"), head)

    def test_changes_outside_the_scanned_sources_do_not_matter(self) -> None:
        head = self.commit()
        (self.root / "README.md").write_text("# app\nnotes\n", encoding="utf-8")
        self.assertEqual(self.source().get("revision"), head)

    def test_uncommitted_java_leaves_the_revision_out(self) -> None:
        self.commit()
        source = self.root / "src/main/java/x/PingController.java"
        source.write_text(CONTROLLER.replace("/ping", "/pong"), encoding="utf-8")
        self.assertNotIn("revision", self.source())

    def test_an_untracked_java_file_leaves_the_revision_out(self) -> None:
        self.commit()
        (self.root / "src/main/java/x/New.java").write_text("package x;\nclass New {}\n", encoding="utf-8")
        self.assertNotIn("revision", self.source())

    def test_outside_git_there_is_no_revision(self) -> None:
        self.assertNotIn("revision", self.source())


if __name__ == "__main__":
    unittest.main()
