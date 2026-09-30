import os
import sys
import unittest
from pathlib import Path
from unittest import mock

SCRIPT_DIR = Path(__file__).resolve().parents[2] / "payload" / "scripts"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from changelog_manager import _build_ai_prompt, classify_commits, render_fallback_md  # noqa: E402

KO = {"PROJECT_AUTO_WIZARD_LANG": "ko"}
EN = {"PROJECT_AUTO_WIZARD_LANG": "en"}


class TestClassifyCommits(unittest.TestCase):
    def test_tier1_title_convention(self):
        out = classify_commits(
            ["로그인 개선 : feat : 소셜 로그인 추가 https://github.com/o/r/issues/1"]
        )
        self.assertTrue(any("소셜 로그인 추가" in s for s in out["feat"]))

    def test_tier1_title_with_bare_colon_not_truncated(self):
        # Title contains a bare ":" (no surrounding spaces) — must not be
        # truncated at that colon; the " : type : " marker is the delimiter.
        out = classify_commits(["v1:2 업그레이드 : feat : 스키마 마이그레이션"])
        self.assertEqual(len(out["feat"]), 1)
        self.assertIn("v1:2 업그레이드", out["feat"][0])
        self.assertIn("스키마 마이그레이션", out["feat"][0])

    def test_tier1_trailing_url_stripped_from_item(self):
        out = classify_commits(
            ["로그인 개선 : feat : 소셜 로그인 추가 https://github.com/o/r/issues/1"]
        )
        self.assertEqual(len(out["feat"]), 1)
        self.assertNotIn("https://", out["feat"][0])
        self.assertIn("소셜 로그인 추가", out["feat"][0])

    def test_tier2_conventional_commits(self):
        out = classify_commits(["feat(auth): add SSO", "fix: null crash"])
        self.assertEqual(len(out["feat"]), 1)
        self.assertEqual(len(out["fix"]), 1)

    def test_tier2_style_build_ci_map_to_chore(self):
        out = classify_commits([
            "perf: speed up query",
            "style: reformat",
            "build: bump toolchain",
            "ci: update workflow",
        ])
        self.assertEqual(len(out["chore"]), 3)
        self.assertEqual(out["perf"], ["speed up query"])

    def test_breaking_deps_and_wip_get_their_own_buckets(self):
        out = classify_commits([
            "feat(api)!: 응답 형식 변경",
            "chore(deps): 의존성 정리",
            "build(deps-dev): bump eslint",
            "Bump lodash from 4.17.20 to 4.17.21",
            "WIP",
            "Update index.js",
        ])
        self.assertEqual(out["breaking"], ["응답 형식 변경"])
        self.assertEqual(out["feat"], [])
        self.assertEqual(len(out["deps"]), 3)
        self.assertEqual(out["wip"], ["WIP"])
        self.assertEqual(out["changes"], ["Update index.js"])

    def test_tier3_freeform_goes_to_changes(self):
        out = classify_commits(["update stuff"])
        self.assertEqual(out["changes"], ["update stuff"])

    def test_skip_ci_and_merge_commits_excluded(self):
        out = classify_commits(["chore: bump [skip ci]", "Merge pull request #3"])
        self.assertEqual(sum(len(v) for v in out.values()), 0)

    def test_empty_lines_excluded(self):
        out = classify_commits(["", "   ", "feat: add thing"])
        self.assertEqual(sum(len(v) for v in out.values()), 1)

    def test_all_buckets_present_even_if_empty(self):
        out = classify_commits([])
        for key in ("breaking", "feat", "fix", "perf", "chore", "docs", "refactor", "test", "deps", "changes", "wip"):
            self.assertIn(key, out)
            self.assertEqual(out[key], [])

    def test_docs_and_refactor_and_test_buckets(self):
        out = classify_commits([
            "docs: update readme",
            "refactor: extract method",
            "test: add unit test",
        ])
        self.assertEqual(len(out["docs"]), 1)
        self.assertEqual(len(out["refactor"]), 1)
        self.assertEqual(len(out["test"]), 1)


@mock.patch.dict(os.environ, KO)
class TestRenderFallbackMd(unittest.TestCase):
    """Korean section titles (language: ko)."""

    def test_version_header_present(self):
        classified = {"feat": [], "fix": [], "chore": [], "docs": [],
                      "refactor": [], "test": [], "changes": ["misc change"]}
        md = render_fallback_md(classified, "1.2.3")
        self.assertIn("1.2.3", md)

    def test_empty_buckets_omitted(self):
        classified = {"feat": ["add X"], "fix": [], "chore": [], "docs": [],
                      "refactor": [], "test": [], "changes": []}
        md = render_fallback_md(classified, "1.0.0")
        self.assertIn("기능", md)
        self.assertNotIn("수정", md)
        self.assertNotIn("문서", md)
        self.assertNotIn("리팩토링", md)
        self.assertNotIn("테스트", md)
        self.assertNotIn("변경사항", md)

    def test_bullet_per_item(self):
        classified = {"feat": ["add X", "add Y"], "fix": [], "chore": [], "docs": [],
                      "refactor": [], "test": [], "changes": []}
        md = render_fallback_md(classified, "1.0.0")
        self.assertIn("- add X", md)
        self.assertIn("- add Y", md)

    def test_chore_and_changes_merged_chore_first(self):
        classified = {"feat": [], "fix": [], "chore": ["bump deps"], "docs": [],
                      "refactor": [], "test": [], "changes": ["misc tweak"]}
        md = render_fallback_md(classified, "1.0.0")
        self.assertIn("변경사항", md)
        chore_idx = md.index("bump deps")
        changes_idx = md.index("misc tweak")
        self.assertLess(chore_idx, changes_idx)

    def test_breaking_section_first_and_wip_last(self):
        classified = classify_commits([
            "feat: add X", "perf: faster", "feat!: drop v1", "WIP", "misc tweak", "chore(deps): bump",
        ])
        md = render_fallback_md(classified, "1.0.0")
        order = [md.index(t) for t in ("### ⚠️ 호환성 깨짐", "### ✨ 기능", "### ⚡ 성능",
                                        "### 📦 의존성", "### 🔧 변경사항", "### 🚧 작업 중")]
        self.assertEqual(order, sorted(order))
        self.assertIn("- drop v1", md)

    def test_all_empty_still_has_version_header(self):
        classified = {"feat": [], "fix": [], "chore": [], "docs": [],
                      "refactor": [], "test": [], "changes": []}
        md = render_fallback_md(classified, "0.0.1")
        self.assertIn("0.0.1", md)


@mock.patch.dict(os.environ, EN)
class TestRenderFallbackMdEnglish(unittest.TestCase):
    """English section titles (the default language)."""

    def test_empty_buckets_omitted(self):
        classified = {"feat": ["add X"], "fix": [], "chore": [], "docs": [],
                      "refactor": [], "test": [], "changes": []}
        md = render_fallback_md(classified, "1.0.0")
        self.assertIn("### ✨ Features", md)
        for absent in ("Fixes", "Documentation", "Refactoring", "Tests", "Changes"):
            self.assertNotIn(absent, md)

    def test_chore_and_changes_merged_chore_first(self):
        classified = {"feat": [], "fix": [], "chore": ["bump deps"], "docs": [],
                      "refactor": [], "test": [], "changes": ["misc tweak"]}
        md = render_fallback_md(classified, "1.0.0")
        self.assertIn("### 🔧 Changes", md)
        self.assertLess(md.index("bump deps"), md.index("misc tweak"))

    def test_section_order(self):
        classified = classify_commits([
            "feat: add X", "perf: faster", "feat!: drop v1", "WIP", "misc tweak", "chore(deps): bump",
        ])
        md = render_fallback_md(classified, "1.0.0")
        titles = ("### ⚠️ Breaking changes", "### ✨ Features", "### ⚡ Performance",
                  "### 📦 Dependencies", "### 🔧 Changes", "### 🚧 Work in progress")
        order = [md.index(x) for x in titles]
        self.assertEqual(order, sorted(order))

    def test_output_has_no_hangul(self):
        md = render_fallback_md(classify_commits(["feat: add X", "fix: y", "WIP"]), "1.0.0")
        self.assertFalse(any("\uac00" <= ch <= "\ud7a3" for ch in md))


class TestAiPromptLanguage(unittest.TestCase):
    def test_english_prompt_uses_english_section_names(self):
        with mock.patch.dict(os.environ, EN):
            prompt = _build_ai_prompt(["feat: add X"], "My PR", "1.2.3", "a.py | 2 +-")
        self.assertIn("## [1.2.3]", prompt)
        self.assertIn("'### ⚠️ Breaking changes'", prompt)
        self.assertIn("PR title: My PR", prompt)
        self.assertIn("- feat: add X", prompt)
        self.assertFalse(any("\uac00" <= ch <= "\ud7a3" for ch in prompt))

    def test_korean_prompt_keeps_original_wording(self):
        with mock.patch.dict(os.environ, KO):
            prompt = _build_ai_prompt(["feat: add X"], "My PR", "1.2.3")
        self.assertIn("아래 커밋 목록을 바탕으로 한국어 릴리즈 요약을 작성해줘.", prompt)
        self.assertIn("'### ⚠️ 호환성 깨짐', '### ✨ 기능', '### 🐛 수정',", prompt)
        self.assertIn("PR 제목: My PR", prompt)


if __name__ == "__main__":
    unittest.main()
