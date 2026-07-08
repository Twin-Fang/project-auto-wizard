import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[2] / "payload" / "scripts"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from changelog_manager import classify_commits, render_fallback_md  # noqa: E402


class TestClassifyCommits(unittest.TestCase):
    def test_tier1_projectops_convention(self):
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

    def test_tier2_perf_style_build_ci_map_to_chore(self):
        out = classify_commits([
            "perf: speed up query",
            "style: reformat",
            "build: bump deps",
            "ci: update workflow",
        ])
        self.assertEqual(len(out["chore"]), 4)

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
        for key in ("feat", "fix", "chore", "docs", "refactor", "test", "changes"):
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


class TestRenderFallbackMd(unittest.TestCase):
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

    def test_all_empty_still_has_version_header(self):
        classified = {"feat": [], "fix": [], "chore": [], "docs": [],
                      "refactor": [], "test": [], "changes": []}
        md = render_fallback_md(classified, "0.0.1")
        self.assertIn("0.0.1", md)


if __name__ == "__main__":
    unittest.main()
