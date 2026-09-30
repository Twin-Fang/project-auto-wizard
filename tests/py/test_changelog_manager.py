import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "payload" / "scripts" / "changelog_manager.py"

SCRIPT_DIR = SCRIPT.parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from changelog_manager import filter_release_issue_numbers  # noqa: E402


def run(args, cwd, lang="ko"):
    # Decoding with the Windows default code page (cp1252) garbles non-ASCII output
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PROJECT_AUTO_WIZARD_LANG": lang}
    return subprocess.run([sys.executable, str(SCRIPT), *args],
                          cwd=cwd, capture_output=True, text=True, encoding="utf-8", env=env)


class TestExportMdFallback(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def test_export_reads_section_from_changelog_md_when_json_missing(self):
        md = ("# Changelog\n\n---\n\n## [0.5.1] - 2026-01-02\n\n**✨ 기능**\n- 새 기능\n\n---\n\n"
              "## [0.5.0] - 2026-01-01\n\n**🐛 수정**\n- 옛 수정\n\n---\n\n")
        (Path(self.tmp) / "CHANGELOG.md").write_text(md, encoding="utf-8")
        r = run(["export", "--version", "0.5.0"], self.tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("- 옛 수정", r.stdout)
        self.assertNotIn("새 기능", r.stdout)
        self.assertNotIn("앱 안정성", r.stdout)
        self.assertNotIn("---", r.stdout)
        r = run(["export", "--version", "0.5.1"], self.tmp)
        self.assertIn("- 새 기능", r.stdout)
        self.assertNotIn("옛 수정", r.stdout)


class TestUpdateFromSummaryIdempotence(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def update(self, version, summary="## [x]\n\n### ✨ 기능\n- 새 기능\n"):
        (Path(self.tmp) / "pr_body.md").write_text(summary, encoding="utf-8")
        env = {**os.environ, "VERSION": version, "PROJECT_TYPES": "node", "TODAY": "2026-01-01",
               "PYTHONIOENCODING": "utf-8"}
        return subprocess.run([sys.executable, str(SCRIPT), "update-from-summary"],
                              cwd=self.tmp, capture_output=True, text=True, encoding="utf-8", env=env)

    def releases(self):
        data = json.loads((Path(self.tmp) / "CHANGELOG.json").read_text(encoding="utf-8"))
        return [r["version"] for r in data["releases"]], data["metadata"]["totalReleases"]

    def test_same_version_is_replaced_not_duplicated(self):
        self.update("0.5.0")
        self.update("0.5.1")
        r = self.update("0.5.1")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(self.releases(), (["0.5.1", "0.5.0"], 2))

    def test_broken_changelog_json_is_not_overwritten(self):
        path = Path(self.tmp) / "CHANGELOG.json"
        path.write_text("{broken", encoding="utf-8")
        r = self.update("0.6.0")
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(path.read_text(encoding="utf-8"), "{broken")

    def test_empty_commit_summary_does_not_repeat_version_header(self):
        r = self.update("0.5.2", summary="## [0.5.2]\n")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        run(["generate-md"], self.tmp)
        md = (Path(self.tmp) / "CHANGELOG.md").read_text(encoding="utf-8")
        self.assertEqual(md.count("## [0.5.2]"), 1)
        self.assertIn("*변경사항 정보 없음*", md)

    def test_empty_commit_summary_english(self):
        r = self.update("0.5.3", summary="## [0.5.3]\n")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        run(["generate-md"], self.tmp, lang="en")
        md = (Path(self.tmp) / "CHANGELOG.md").read_text(encoding="utf-8")
        self.assertIn("**Current version:** 0.5.3", md)
        self.assertIn("**Last updated:**", md)
        self.assertIn("*No change information*", md)
        self.assertFalse(any("\uac00" <= ch <= "\ud7a3" for ch in md))

    def test_korean_header_kept_in_ko(self):
        self.update("0.5.4", summary="## [0.5.4]\n")
        run(["generate-md"], self.tmp, lang="ko")
        md = (Path(self.tmp) / "CHANGELOG.md").read_text(encoding="utf-8")
        self.assertTrue(md.startswith("# Changelog\n\n**현재 버전:** 0.5.4  \n**마지막 업데이트:**"))


class TestGenerateMd(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def test_generate_md_from_seed_changelog_json(self):
        seed = {
            "metadata": {
                "lastUpdated": "2026-01-01T00:00:00Z",
                "currentVersion": "1.2.3",
                "projectTypes": ["spring"],
                "totalReleases": 1,
            },
            "releases": [
                {
                    "version": "1.2.3",
                    "project_types": ["spring"],
                    "date": "2026-01-01",
                    "pr_number": 42,
                    "raw_summary": "Initial release",
                    "parsed_changes": {
                        "features": {
                            "title": "Features",
                            "items": ["Add login"],
                        }
                    },
                    "parse_method": "markdown",
                }
            ],
        }
        (Path(self.tmp) / "CHANGELOG.json").write_text(
            json.dumps(seed, indent=2, ensure_ascii=False), encoding="utf-8"
        )

        r = run(["generate-md"], self.tmp)
        self.assertEqual(r.returncode, 0, msg=r.stderr)

        md_path = Path(self.tmp) / "CHANGELOG.md"
        self.assertTrue(md_path.is_file())
        content = md_path.read_text(encoding="utf-8")
        self.assertIn("1.2.3", content)
        self.assertIn("Add login", content)


if __name__ == "__main__":
    unittest.main()


class TestUpdateFromSummaryDegenerateJson(unittest.TestCase):
    """Regression: with an irregular scaffold CHANGELOG.json ({"versions": []}),
    update-from-summary used to die with KeyError: 'metadata'."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def test_existing_json_without_metadata_key(self):
        import os
        Path(self.tmp, "CHANGELOG.json").write_text('{"versions": []}', encoding="utf-8")
        Path(self.tmp, "pr_body.md").write_text("### Features\n- add thing\n", encoding="utf-8")
        env = {**os.environ,
               "VERSION": "0.1.3", "PROJECT_TYPES": "node",
               "TODAY": "2026-07-09", "PR_NUMBER": "1", "TIMESTAMP": "2026-07-09T00:00:00Z",
               "PYTHONIOENCODING": "utf-8"}
        r = subprocess.run([sys.executable, str(SCRIPT), "update-from-summary"],
                           cwd=self.tmp, capture_output=True, text=True,
                           encoding="utf-8", env=env)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        data = json.loads(Path(self.tmp, "CHANGELOG.json").read_text(encoding="utf-8"))
        self.assertEqual(data["metadata"]["currentVersion"], "0.1.3")
        self.assertEqual(len(data["releases"]), 1)


class TestFilterReleaseIssueNumbers(unittest.TestCase):
    def test_filters_by_merge_commit_sha_and_extracts_issue_number(self):
        commit_shas = {"abc123", "def456"}
        merged_prs = [
            {"number": 100, "headRefName": "20260823_#99_fix", "mergeCommit": {"oid": "abc123"}},
            {"number": 101, "headRefName": "20260823_#98_other", "mergeCommit": {"oid": "zzz999"}},
        ]
        self.assertEqual(filter_release_issue_numbers(commit_shas, merged_prs), ["99"])

    def test_dedupes_issue_numbers(self):
        commit_shas = {"a1", "a2"}
        merged_prs = [
            {"number": 1, "headRefName": "20260101_#5_first", "mergeCommit": {"oid": "a1"}},
            {"number": 2, "headRefName": "20260102_#5_second", "mergeCommit": {"oid": "a2"}},
        ]
        self.assertEqual(filter_release_issue_numbers(commit_shas, merged_prs), ["5"])

    def test_skips_prs_without_issue_number_in_branch(self):
        commit_shas = {"a1"}
        merged_prs = [{"number": 1, "headRefName": "cleanup-docs-typo", "mergeCommit": {"oid": "a1"}}]
        self.assertEqual(filter_release_issue_numbers(commit_shas, merged_prs), [])

    def test_extracts_issue_number_from_worktree_branch(self):
        commit_shas = {"a1"}
        merged_prs = [{"number": 1, "headRefName": "worktree-issue-93-branch-strategy", "mergeCommit": {"oid": "a1"}}]
        self.assertEqual(filter_release_issue_numbers(commit_shas, merged_prs), ["93"])

    def test_skips_prs_not_in_commit_shas(self):
        commit_shas = {"a1"}
        merged_prs = [{"number": 1, "headRefName": "20260101_#5_x", "mergeCommit": {"oid": "not-in-range"}}]
        self.assertEqual(filter_release_issue_numbers(commit_shas, merged_prs), [])

    def test_handles_missing_merge_commit_gracefully(self):
        commit_shas = {"a1"}
        merged_prs = [{"number": 1, "headRefName": "20260101_#5_x", "mergeCommit": None}]
        self.assertEqual(filter_release_issue_numbers(commit_shas, merged_prs), [])


class TestCollectIssueClosesCli(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def test_prints_comma_separated_issue_numbers(self):
        Path(self.tmp, "shas.txt").write_text("abc123\n", encoding="utf-8")
        Path(self.tmp, "prs.json").write_text(
            json.dumps([{"number": 1, "headRefName": "20260101_#7_x", "mergeCommit": {"oid": "abc123"}}]),
            encoding="utf-8",
        )
        r = run(
            ["collect-issue-closes", "--commit-shas-file", "shas.txt", "--merged-prs-file", "prs.json"],
            self.tmp,
        )
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "7")

    def test_empty_result_prints_empty_line(self):
        Path(self.tmp, "shas.txt").write_text("abc123\n", encoding="utf-8")
        Path(self.tmp, "prs.json").write_text("[]", encoding="utf-8")
        r = run(
            ["collect-issue-closes", "--commit-shas-file", "shas.txt", "--merged-prs-file", "prs.json"],
            self.tmp,
        )
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "")


class TestLanguageIndependentCategoryKeys(unittest.TestCase):
    """parsed_changes keys must not depend on the language the notes were written in."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def update(self, version, summary, lang):
        (Path(self.tmp) / "pr_body.md").write_text(summary, encoding="utf-8")
        env = {**os.environ, "VERSION": version, "PROJECT_TYPES": "node", "TODAY": "2026-01-01",
               "PYTHONIOENCODING": "utf-8", "PROJECT_AUTO_WIZARD_LANG": lang}
        r = subprocess.run([sys.executable, str(SCRIPT), "update-from-summary"],
                           cwd=self.tmp, capture_output=True, text=True, encoding="utf-8", env=env)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def data(self):
        return json.loads((Path(self.tmp) / "CHANGELOG.json").read_text(encoding="utf-8"))

    def write_json(self, releases):
        (Path(self.tmp) / "CHANGELOG.json").write_text(json.dumps(
            {"metadata": {"currentVersion": "1.0.0", "lastUpdated": "x"}, "releases": releases},
            ensure_ascii=False), encoding="utf-8")

    def test_same_category_gets_the_same_key_in_every_language(self):
        self.update("1.0.0", "## [1.0.0]\n\n### ⚠️ Breaking changes\n- drop v1\n\n### ✨ Features\n- add x\n", "en")
        self.update("1.0.1", "## [1.0.1]\n\n### ⚠️ 호환성 깨짐\n- v1 제거\n\n### ✨ 기능\n- x 추가\n", "ko")
        releases = self.data()["releases"]
        self.assertEqual(list(releases[0]["parsed_changes"]), ["breaking", "feat"])
        self.assertEqual(list(releases[1]["parsed_changes"]), ["breaking", "feat"])

    def test_custom_category_keeps_a_title_based_key(self):
        self.update("1.0.0", "## [1.0.0]\n\n### 🎨 Design tweaks\n- polish\n", "en")
        self.assertEqual(list(self.data()["releases"][0]["parsed_changes"]), ["design_tweaks"])

    def test_generate_md_merges_legacy_language_keys_and_follows_current_language(self):
        self.write_json([{
            "version": "1.0.0", "date": "2026-01-01", "parse_method": "markdown",
            "parsed_changes": {
                "features": {"title": "✨ Features", "items": ["add x", "add y"]},
                "기능": {"title": "✨ 기능", "items": ["add y", "x 추가"]},
                "breaking_changes": {"title": "⚠️ Breaking changes", "items": ["drop v1"]},
            },
        }])
        for lang, feat, brk in (("ko", "**✨ 기능**", "**⚠️ 호환성 깨짐**"), ("en", "**✨ Features**", "**⚠️ Breaking changes**")):
            with self.subTest(lang):
                r = run(["generate-md"], self.tmp, lang=lang)
                self.assertEqual(r.returncode, 0, r.stderr)
                md = (Path(self.tmp) / "CHANGELOG.md").read_text(encoding="utf-8")
                self.assertEqual(md.count(feat), 1, md)
                self.assertEqual(md.count(brk), 1, md)
                self.assertIn("- add x\n- add y\n- x 추가\n", md)
                # The other language's heading must not linger
                other = "**✨ Features**" if lang == "ko" else "**✨ 기능**"
                self.assertNotIn(other, md)

    def test_generate_md_keeps_list_style_legacy_entries_readable(self):
        self.write_json([{"version": "1.0.0", "date": "d", "parsed_changes": {"fix": ["repair"]}}])
        r = run(["generate-md"], self.tmp, lang="en")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("**🐛 Fixes**\n- repair\n", (Path(self.tmp) / "CHANGELOG.md").read_text(encoding="utf-8"))

    def test_export_merges_legacy_keys_under_one_heading(self):
        self.write_json([{
            "version": "1.0.0", "date": "d",
            "parsed_changes": {
                "fixes": {"title": "🐛 Fixes", "items": ["a"]},
                "수정": {"title": "🐛 수정", "items": ["b"]},
            },
        }])
        r = run(["export", "--version", "1.0.0"], self.tmp, lang="ko")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.count("**🐛 수정**"), 1, r.stdout)
        self.assertIn("- a\n- b", r.stdout)
        self.assertNotIn("Fixes", r.stdout)
