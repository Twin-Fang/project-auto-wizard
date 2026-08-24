import json
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


def run(args, cwd):
    return subprocess.run([sys.executable, str(SCRIPT), *args],
                          cwd=cwd, capture_output=True, text=True)


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
    """실측 회귀 (dogfood PR #1): 스캐폴드가 만든 비정형 CHANGELOG.json({"versions": []})에서
    update-from-summary가 KeyError: 'metadata'로 죽던 버그."""

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
        merged_prs = [{"number": 1, "headRefName": "worktree-issue-93-branch-strategy", "mergeCommit": {"oid": "a1"}}]
        self.assertEqual(filter_release_issue_numbers(commit_shas, merged_prs), [])

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
