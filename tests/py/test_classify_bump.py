import shutil
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[2] / "payload" / "scripts"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import changelog_manager  # noqa: E402


class TestClassifyBumpLevel(unittest.TestCase):
    def test_feat_conventional_commit_is_minor(self):
        self.assertEqual(changelog_manager.classify_bump_level(["feat: add login flow"]), "minor")

    def test_feat_projectops_convention_is_minor(self):
        self.assertEqual(changelog_manager.classify_bump_level(["로그인 기능 : feat : 소셜 로그인 추가"]), "minor")

    def test_bang_marker_on_any_type_is_major(self):
        self.assertEqual(changelog_manager.classify_bump_level(["feat!: drop legacy config format"]), "major")
        self.assertEqual(changelog_manager.classify_bump_level(["fix!: change default timeout unit"]), "major")
        self.assertEqual(changelog_manager.classify_bump_level(["chore!: remove deprecated CLI flag"]), "major")

    def test_bang_with_scope_is_major(self):
        self.assertEqual(changelog_manager.classify_bump_level(["feat(api)!: change response shape"]), "major")

    def test_fix_only_is_patch(self):
        self.assertEqual(changelog_manager.classify_bump_level(["fix: crash on start", "chore: bump deps"]), "patch")

    def test_unmatched_freeform_commits_are_patch(self):
        self.assertEqual(changelog_manager.classify_bump_level(["updated stuff", "wip"]), "patch")

    def test_empty_list_is_patch(self):
        self.assertEqual(changelog_manager.classify_bump_level([]), "patch")

    def test_major_wins_over_minor_in_same_release(self):
        lines = ["feat: add dashboard", "feat!: remove v1 API"]
        self.assertEqual(changelog_manager.classify_bump_level(lines), "major")

    def test_skip_ci_and_merge_lines_are_ignored(self):
        lines = ["[skip ci] chore(version): bump to v1.2.3", "Merge pull request #1"]
        self.assertEqual(changelog_manager.classify_bump_level(lines), "patch")


class TestCmdClassifyBump(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.env_patcher = None

    def _run(self, commit_lines, capsys_lines):
        commits_file = Path(self.tmp) / "commits.txt"
        commits_file.write_text("\n".join(commit_lines) + "\n", encoding="utf-8")
        import io
        import contextlib
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = changelog_manager.main(["classify-bump", "--commits-file", str(commits_file)])
        return rc, out.getvalue().strip().splitlines()[-1]

    def test_cli_prints_bump_as_last_stdout_line(self):
        rc, last_line = self._run(["feat: add login"], [])
        self.assertEqual(rc, 0)
        self.assertEqual(last_line, "minor")

    def test_cli_missing_commits_file_treated_as_empty(self):
        import contextlib
        import io
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = changelog_manager.main(["classify-bump", "--commits-file", str(Path(self.tmp) / "missing.txt")])
        self.assertEqual(rc, 0)
        self.assertEqual(out.getvalue().strip().splitlines()[-1], "patch")


if __name__ == "__main__":
    unittest.main()
