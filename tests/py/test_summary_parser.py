"""Regression tests for parsing the summary Markdown produced by the engine chain.

The `### Section` + `- item` format (the one render_fallback_md and
_build_ai_prompt specify) is the only input format. These tests pin that it
parses into categories and items exactly. Section titles are parsed verbatim,
so both English and Korean headings must work (existing repos hold Korean history).
"""

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPT = Path(__file__).resolve().parents[2] / "payload" / "scripts" / "changelog_manager.py"

# payload/ is part of the npm package (files whitelist) — a payload/scripts/__pycache__/*.pyc
# created as an import side effect would pollute the npm pack output.
sys.dont_write_bytecode = True

_spec = importlib.util.spec_from_file_location("changelog_manager", SCRIPT)
cm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cm)


class TestSectionFormatParsing(unittest.TestCase):
    """The format the engine really emits parses correctly (Korean headings)."""

    def test_section_headings_become_categories(self):
        md = (
            "## [1.2.3]\n"
            "\n"
            "### ✨ 기능\n"
            "- 사용자 로그인 추가\n"
            "- 대시보드 위젯 추가\n"
            "\n"
            "### 🐛 수정\n"
            "- 널 포인터 예외 수정\n"
        )
        parsed = cm._parse_summary_markdown(md)

        titles = {v["title"]: v["items"] for v in parsed.values()}
        self.assertIn("✨ 기능", titles)
        self.assertIn("🐛 수정", titles)
        self.assertEqual(titles["✨ 기능"], ["사용자 로그인 추가", "대시보드 위젯 추가"])
        self.assertEqual(titles["🐛 수정"], ["널 포인터 예외 수정"])

    def test_version_header_is_not_a_category(self):
        """A `## [1.2.3]` version heading must not become a category."""
        md = "## [1.2.3]\n\n### ✨ 기능\n- 항목\n"
        parsed = cm._parse_summary_markdown(md)
        self.assertEqual(len(parsed), 1)
        self.assertEqual(next(iter(parsed.values()))["title"], "✨ 기능")

    def test_bullets_are_not_split_into_empty_categories(self):
        """Regression: each bullet used to be split into a category with zero items."""
        md = "### 🔧 변경사항\n- 의존성 업그레이드\n- 로깅 정리\n"
        parsed = cm._parse_summary_markdown(md)
        self.assertEqual(len(parsed), 1)
        only = next(iter(parsed.values()))
        self.assertEqual(only["items"], ["의존성 업그레이드", "로깅 정리"])

    def test_dash_and_asterisk_markers_both_supported(self):
        md = "### 기능\n* 별표 항목\n- 대시 항목\n"
        parsed = cm._parse_summary_markdown(md)
        only = next(iter(parsed.values()))
        self.assertEqual(only["items"], ["별표 항목", "대시 항목"])

    def test_render_fallback_md_output_round_trips(self):
        """The rule-based fallback renderer output must parse back as is (ko)."""
        with mock.patch.dict(os.environ, {"PROJECT_AUTO_WIZARD_LANG": "ko"}):
            self._round_trip_ko()

    def test_render_fallback_md_output_round_trips_english(self):
        """Same round trip with the English section titles (default language)."""
        with mock.patch.dict(os.environ, {"PROJECT_AUTO_WIZARD_LANG": "en"}):
            classified = {"feat": ["feature A"], "fix": ["bug B"], "chore": ["chore C"], "changes": []}
            parsed = cm._parse_summary_markdown(cm.render_fallback_md(classified, "9.9.9"))
        flattened = {v["title"]: v["items"] for v in parsed.values()}
        self.assertEqual(flattened.get("✨ Features"), ["feature A"])
        self.assertEqual(flattened.get("🐛 Fixes"), ["bug B"])
        self.assertEqual(flattened.get("🔧 Changes"), ["chore C"])

    def _round_trip_ko(self):
        classified = {
            "feat": ["기능 A"],
            "fix": ["버그 B"],
            "chore": ["잡무 C"],
            "changes": [],
        }
        md = cm.render_fallback_md(classified, "9.9.9")
        parsed = cm._parse_summary_markdown(md)

        flattened = {v["title"]: v["items"] for v in parsed.values()}
        self.assertEqual(flattened.get("✨ 기능"), ["기능 A"])
        self.assertEqual(flattened.get("🐛 수정"), ["버그 B"])
        self.assertEqual(flattened.get("🔧 변경사항"), ["잡무 C"])

    def test_nested_bullet_format_still_parses(self):
        """The legacy nested-bullet format is still handled by the fallback parser (backward compatible)."""
        md = "* **Features**\n  * add login\n  * add widget\n"
        parsed = cm._parse_summary_markdown(md)
        only = next(iter(parsed.values()))
        self.assertEqual(only["title"], "Features")
        self.assertEqual(only["items"], ["add login", "add widget"])


class TestUpdateFromSummaryEndToEnd(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def test_ai_summary_lands_in_changelog_json(self):
        Path(self.tmp, "pr_body.md").write_text(
            "## [0.2.0]\n\n### ✨ 기능\n- 새 명령 추가\n\n### 🐛 수정\n- 경로 처리 수정\n",
            encoding="utf-8",
        )
        env = {
            **os.environ,
            "VERSION": "0.2.0",
            "PROJECT_TYPES": "node",
            "TODAY": "2026-08-03",
            "PR_NUMBER": "14",
            "TIMESTAMP": "2026-08-03T00:00:00Z",
            "PYTHONIOENCODING": "utf-8",
        }
        r = subprocess.run(
            [sys.executable, str(SCRIPT), "update-from-summary"],
            cwd=self.tmp, capture_output=True, text=True, encoding="utf-8", env=env,
        )
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

        data = json.loads(Path(self.tmp, "CHANGELOG.json").read_text(encoding="utf-8"))
        release = data["releases"][0]
        self.assertEqual(release["parse_method"], "markdown")

        flattened = {v["title"]: v["items"] for v in release["parsed_changes"].values()}
        self.assertEqual(flattened.get("✨ 기능"), ["새 명령 추가"])
        self.assertEqual(flattened.get("🐛 수정"), ["경로 처리 수정"])


if __name__ == "__main__":
    unittest.main()
