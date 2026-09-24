import shutil
import subprocess
import sys
import tempfile
import unittest
import unittest.mock
from pathlib import Path
from urllib.error import URLError

SCRIPT_DIR = Path(__file__).resolve().parents[2] / "payload" / "scripts"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import changelog_manager  # noqa: E402


class TestClassifyBumpLevel(unittest.TestCase):
    def test_feat_conventional_commit_is_minor(self):
        self.assertEqual(changelog_manager.classify_bump_level(["feat: add login flow"]), "minor")

    def test_feat_title_convention_is_minor(self):
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


class TestAiAssistedBumpUpgrade(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.env_patcher = unittest.mock.patch.dict(changelog_manager.os.environ, {}, clear=True)
        self.env_patcher.start()
        self.addCleanup(self.env_patcher.stop)

    def _set_user_api_env(self):
        changelog_manager.os.environ.update({
            "AI_API_KEY": "sk-test",
            "AI_API_BASE_URL": "https://api.example.com/v1",
            "AI_MODEL": "example-model",
        })

    def _enable_copilot(self):
        changelog_manager.os.environ.update({"COPILOT_AI": "true", "GITHUB_TOKEN": "ghs_test"})

    def _completed(self, stdout, returncode=0):
        return subprocess.CompletedProcess(args=["copilot"], returncode=returncode, stdout=stdout, stderr="")

    def _run(self, commit_lines):
        import contextlib
        import io
        commits_file = Path(self.tmp) / "commits.txt"
        commits_file.write_text("\n".join(commit_lines) + "\n", encoding="utf-8")
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = changelog_manager.main(["classify-bump", "--commits-file", str(commits_file)])
        return rc, out.getvalue().strip().splitlines()[-1]

    def _mock_response(self, content):
        m = unittest.mock.MagicMock()
        m.read.return_value = ('{"choices":[{"message":{"content":"%s"}}]}' % content).encode("utf-8")
        m.__enter__.return_value = m
        m.__exit__.return_value = False
        return m

    def test_ai_upgrades_patch_to_minor_when_response_is_MINOR(self):
        self._set_user_api_env()
        with unittest.mock.patch.object(
            changelog_manager.urllib.request, "urlopen", return_value=self._mock_response("MINOR"),
        ):
            rc, last_line = self._run(["add dark mode toggle to settings screen"])
        self.assertEqual(rc, 0)
        self.assertEqual(last_line, "minor")

    def test_ai_keeps_patch_when_response_is_PATCH(self):
        self._set_user_api_env()
        with unittest.mock.patch.object(
            changelog_manager.urllib.request, "urlopen", return_value=self._mock_response("PATCH"),
        ):
            rc, last_line = self._run(["tweak internal logging format"])
        self.assertEqual(rc, 0)
        self.assertEqual(last_line, "patch")

    def test_ai_never_produces_major(self):
        self._set_user_api_env()
        with unittest.mock.patch.object(
            changelog_manager.urllib.request, "urlopen", return_value=self._mock_response("MAJOR"),
        ):
            rc, last_line = self._run(["completely rewrite the public API"])
        self.assertEqual(rc, 0)
        # 응답이 형식을 안 지키면(정확히 MINOR가 아니면) 규칙 결과 patch로 확정 — major는 나올 수 없음.
        self.assertEqual(last_line, "patch")

    def test_ai_call_failure_falls_back_to_rule_result(self):
        self._set_user_api_env()
        with unittest.mock.patch.object(
            changelog_manager.urllib.request, "urlopen", side_effect=URLError("timed out"),
        ):
            rc, last_line = self._run(["random freeform commit message"])
        self.assertEqual(rc, 0)
        self.assertEqual(last_line, "patch")

    def test_no_api_key_no_token_skips_ai_and_stays_patch(self):
        rc, last_line = self._run(["random freeform commit message"])
        self.assertEqual(rc, 0)
        self.assertEqual(last_line, "patch")

    def test_feat_result_never_calls_ai(self):
        with unittest.mock.patch.object(changelog_manager.urllib.request, "urlopen") as mock_urlopen:
            rc, last_line = self._run(["feat: add login"])
        self.assertEqual(last_line, "minor")
        mock_urlopen.assert_not_called()

    def test_user_key_without_url_and_model_sends_nothing(self):
        changelog_manager.os.environ["AI_API_KEY"] = "sk-test"
        with unittest.mock.patch.object(changelog_manager.urllib.request, "urlopen") as mock_urlopen:
            rc, last_line = self._run(["add dark mode toggle to settings screen"])
        self.assertEqual(rc, 0)
        self.assertEqual(last_line, "patch")
        mock_urlopen.assert_not_called()

    def test_copilot_upgrades_patch_to_minor_when_response_is_exactly_MINOR(self):
        self._enable_copilot()
        with unittest.mock.patch.object(
            changelog_manager.subprocess, "run", return_value=self._completed("MINOR\n"),
        ) as mock_run:
            rc, last_line = self._run(["add dark mode toggle to settings screen"])
        self.assertEqual(rc, 0)
        self.assertEqual(last_line, "minor")
        mock_run.assert_called_once()

    def test_copilot_response_other_than_exactly_MINOR_stays_patch(self):
        self._enable_copilot()
        for response in ("PATCH", "MAJOR", "MINOR because it adds a feature", ""):
            with self.subTest(response=response):
                with unittest.mock.patch.object(
                    changelog_manager.subprocess, "run", return_value=self._completed(response),
                ):
                    rc, last_line = self._run(["add dark mode toggle to settings screen"])
                self.assertEqual(rc, 0)
                self.assertEqual(last_line, "patch")

    def test_copilot_disabled_never_spawns_even_with_token(self):
        changelog_manager.os.environ["GITHUB_TOKEN"] = "ghs_test"
        with unittest.mock.patch.object(changelog_manager.subprocess, "run") as mock_run:
            rc, last_line = self._run(["add dark mode toggle to settings screen"])
        self.assertEqual(last_line, "patch")
        mock_run.assert_not_called()

    def test_copilot_failure_stays_patch(self):
        self._enable_copilot()
        with unittest.mock.patch.object(
            changelog_manager.subprocess, "run", side_effect=FileNotFoundError("copilot"),
        ):
            rc, last_line = self._run(["add dark mode toggle to settings screen"])
        self.assertEqual(rc, 0)
        self.assertEqual(last_line, "patch")

    def test_user_api_failure_chains_to_copilot(self):
        self._set_user_api_env()
        self._enable_copilot()
        with unittest.mock.patch.object(
            changelog_manager.urllib.request, "urlopen", side_effect=URLError("timed out"),
        ):
            with unittest.mock.patch.object(
                changelog_manager.subprocess, "run", return_value=self._completed("MINOR"),
            ):
                rc, last_line = self._run(["add dark mode toggle to settings screen"])
        self.assertEqual(last_line, "minor")


if __name__ == "__main__":
    unittest.main()
