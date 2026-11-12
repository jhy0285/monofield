"""Handlers that share one URL and are told apart by a request parameter.

`@PostMapping(value = "/save.do", params = "!cmd")` and `params = "cmd=Regist"` are two different calls for a
caller (eGovFrame uses the pair for "open the form" and "submit it"). They must stay two rows with different
routes: a document with the same `METHOD path` twice cannot be rendered or compared.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]


def scan(sources: dict[str, str]) -> dict:
    with tempfile.TemporaryDirectory() as temp_dir:
        root = Path(temp_dir) / "app"
        for relative, body in sources.items():
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(textwrap.dedent(body), encoding="utf-8")
        out = Path(temp_dir) / "spec.json"
        subprocess.run([sys.executable, str(SCRIPTS_DIR / "scan_spring.py"), "--codebase-path", str(root), "--out", str(out)],
                       check=True, capture_output=True, text=True)
        return json.loads(out.read_text(encoding="utf-8"))


JAVA = {
    "src/main/java/demo/web/InsttController.java": """
        package demo.web;

        import org.springframework.stereotype.Controller;
        import org.springframework.web.bind.annotation.*;

        @Controller
        public class InsttController {
            /** 등록 화면으로 이동한다 */
            @PostMapping(value = "/instt/add.do", params = "!cmd")
            public String addView(@RequestParam("insttId") String insttId) { return "instt/Regist"; }

            /** 기관을 등록한다 */
            @PostMapping(value = "/instt/add.do", params = "cmd=Regist")
            public String add(@RequestParam("insttNm") String insttNm) { return "forward:/instt/list.do"; }

            /** 기관을 수정하거나 삭제한다 */
            @RequestMapping(value = "/instt/update.do", method = RequestMethod.POST, params = {"cmd=Modify", "confirm"})
            public String update(@RequestParam("insttNm") String insttNm) { return "forward:/instt/list.do"; }

            /** 조건이 붙었지만 혼자 쓰는 주소 */
            @GetMapping(value = "/instt/list.do", params = "cmd!=excel")
            public String list() { return "instt/List"; }
        }
    """,
}

KOTLIN = {
    "src/main/kotlin/demo/web/InsttController.kt": """
        package demo.web

        import org.springframework.web.bind.annotation.*

        @RestController
        class InsttController {
            @PostMapping("/instt/add", params = ["!cmd"])
            fun addView(@RequestParam insttId: String): String = "view"

            @PostMapping("/instt/add", params = ["cmd=Regist"])
            fun add(@RequestParam insttNm: String): String = "done"
        }
    """,
}


class MappingConditions(unittest.TestCase):
    def test_java_handlers_on_one_url_are_separate_routes(self) -> None:
        doc = scan(JAVA)
        routes = [f'{e["method"]} {e["path"]}' for e in doc["endpoints"]]
        self.assertEqual(sorted(routes), [
            "GET /instt/list.do",
            "POST /instt/add.do",
            "POST /instt/add.do?cmd=Regist",
            "POST /instt/update.do?cmd=Modify&confirm",
        ])
        self.assertEqual(len(set(routes)), len(routes))
        by = {f'{e["method"]} {e["path"]}': e for e in doc["endpoints"]}
        self.assertEqual([f["nameEn"] for f in by["POST /instt/add.do"]["requestFields"]], ["insttId"])
        self.assertEqual([f["nameEn"] for f in by["POST /instt/add.do?cmd=Regist"]["requestFields"]], ["insttNm"])
        self.assertEqual(by["POST /instt/add.do?cmd=Regist"]["interfaceName"], "기관을 등록한다")

    def test_kotlin_handlers_on_one_url_are_separate_routes(self) -> None:
        routes = sorted(f'{e["method"]} {e["path"]}' for e in scan(KOTLIN)["endpoints"])
        self.assertEqual(routes, ["POST /instt/add", "POST /instt/add?cmd=Regist"])


if __name__ == "__main__":
    unittest.main()
