"""AI 엔진 체인이 생성하는 요약 Markdown의 파싱 회귀 테스트.

CodeRabbit 제거 이후 `### 섹션` + `- 항목` 형식(render_fallback_md 및
_build_ai_prompt가 지정하는 형식)이 유일한 입력 형식이 된다. 이 형식이
카테고리·항목으로 정확히 파싱되는지를 고정한다.
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

SCRIPT = Path(__file__).resolve().parents[2] / "payload" / "scripts" / "changelog_manager.py"

# payload/는 npm 패키징 대상(files 화이트리스트) — import 부작용으로
# payload/scripts/__pycache__/*.pyc가 생기면 npm pack 산출물을 오염시킨다.
sys.dont_write_bytecode = True

_spec = importlib.util.spec_from_file_location("changelog_manager", SCRIPT)
cm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cm)


class TestSectionFormatParsing(unittest.TestCase):
    """AI 엔진이 실제로 뱉는 형식이 파싱되는지."""

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
        """`## [1.2.3]` 버전 헤더가 카테고리로 잡히면 안 된다."""
        md = "## [1.2.3]\n\n### ✨ 기능\n- 항목\n"
        parsed = cm._parse_summary_markdown(md)
        self.assertEqual(len(parsed), 1)
        self.assertEqual(next(iter(parsed.values()))["title"], "✨ 기능")

    def test_bullets_are_not_split_into_empty_categories(self):
        """회귀: 각 불릿이 항목 0개짜리 카테고리로 쪼개지던 버그."""
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
        """규칙 기반 폴백 렌더러의 출력이 그대로 다시 파싱되어야 한다."""
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
        """구형 중첩 불릿 형식도 폴백 파서로 계속 처리된다(하위호환)."""
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
