import contextlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import URLError

SCRIPT_DIR = Path(__file__).resolve().parents[2] / "payload" / "scripts"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import changelog_manager  # noqa: E402

VALID_SUMMARY = "## [1.2.3]\n\n### ✨ 기능\n- 로그인 추가\n"


def _completed(stdout="", returncode=0, stderr=""):
    return subprocess.CompletedProcess(args=["copilot"], returncode=returncode, stdout=stdout, stderr=stderr)


def _last_json_line(text):
    return json.loads([line for line in text.splitlines() if line.strip()][-1])


class TestIsValidCopilotSummary(unittest.TestCase):
    def test_accepts_response_with_section_heading(self):
        self.assertTrue(changelog_manager._is_valid_copilot_summary(VALID_SUMMARY))

    def test_rejects_empty_or_whitespace(self):
        self.assertFalse(changelog_manager._is_valid_copilot_summary(""))
        self.assertFalse(changelog_manager._is_valid_copilot_summary("  \n "))

    def test_rejects_response_without_any_section_heading(self):
        self.assertFalse(changelog_manager._is_valid_copilot_summary("## [1.2.3]\n\n- 로그인 추가\n"))
        self.assertFalse(changelog_manager._is_valid_copilot_summary("요약은 다음과 같습니다. 로그인이 추가되었습니다."))

    def test_rejects_response_wrapped_in_code_fence(self):
        fenced = "```markdown\n" + VALID_SUMMARY + "```\n"
        self.assertFalse(changelog_manager._is_valid_copilot_summary(fenced))


class TestCallCopilotCli(unittest.TestCase):
    def setUp(self):
        env_patcher = patch.dict(
            changelog_manager.os.environ,
            {"GITHUB_TOKEN": "ghs_test"},
            clear=True,
        )
        env_patcher.start()
        self.addCleanup(env_patcher.stop)

    def test_command_is_locked_down_text_only(self):
        with patch.object(changelog_manager.subprocess, "run", return_value=_completed("ok")) as mock_run:
            out = changelog_manager.call_copilot_cli("PROMPT")

        self.assertEqual(out, "ok")
        args = mock_run.call_args.args[0]
        self.assertEqual(args[0], "copilot")
        self.assertEqual(args[args.index("-p") + 1], "PROMPT")
        for flag in (
            "-s", "--no-ask-user", "--no-color", "--no-custom-instructions", "--disable-builtin-mcps",
            "--deny-tool=shell", "--deny-tool=write", "--deny-tool=url",
        ):
            self.assertIn(flag, args)
        for forbidden in ("--allow-all-tools", "--allow-all", "--yolo", "--allow-all-paths", "--allow-all-urls"):
            self.assertNotIn(forbidden, args)
        self.assertEqual(args[args.index("--model") + 1], changelog_manager._COPILOT_DEFAULT_MODEL)

    def test_model_can_be_overridden_by_env(self):
        changelog_manager.os.environ["COPILOT_MODEL"] = "my-model"
        with patch.object(changelog_manager.subprocess, "run", return_value=_completed("ok")) as mock_run:
            changelog_manager.call_copilot_cli("PROMPT")
        args = mock_run.call_args.args[0]
        self.assertEqual(args[args.index("--model") + 1], "my-model")

    def test_runs_in_empty_temp_dir_with_timeout_and_no_stdin(self):
        seen = {}

        def fake_run(args, **kwargs):
            seen["listing"] = os.listdir(kwargs["cwd"])
            seen["cwd"] = kwargs["cwd"]
            seen["timeout"] = kwargs["timeout"]
            seen["stdin"] = kwargs["stdin"]
            return _completed("ok")

        with patch.object(changelog_manager.subprocess, "run", side_effect=fake_run):
            changelog_manager.call_copilot_cli("PROMPT")

        self.assertEqual(seen["listing"], [])
        self.assertNotEqual(Path(seen["cwd"]).resolve(), Path.cwd().resolve())
        self.assertEqual(seen["timeout"], changelog_manager._COPILOT_TIMEOUT_SECONDS)
        self.assertEqual(seen["stdin"], subprocess.DEVNULL)

    def test_nonzero_exit_raises(self):
        with patch.object(
            changelog_manager.subprocess, "run",
            return_value=_completed("", returncode=1, stderr="Error: Authentication failed"),
        ):
            with self.assertRaises(RuntimeError) as ctx:
                changelog_manager.call_copilot_cli("PROMPT")
        self.assertIn("Authentication failed", str(ctx.exception))


class TestCopilotEngineChain(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.commits_file = Path(self.tmp) / "commits.txt"
        self.commits_file.write_text("feat: add login\nfix: crash on start\n", encoding="utf-8")
        self.output_file = Path(self.tmp) / "summary.md"
        env_patcher = patch.dict(changelog_manager.os.environ, {}, clear=True)
        env_patcher.start()
        self.addCleanup(env_patcher.stop)

    def _enable_copilot(self):
        changelog_manager.os.environ.update({"COPILOT_AI": "true", "GITHUB_TOKEN": "ghs_test"})

    def _run_capture(self):
        out_buf, err_buf = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out_buf), contextlib.redirect_stderr(err_buf):
            rc = changelog_manager.main([
                "ai-summary", "--commits-file", str(self.commits_file),
                "--version", "1.2.3", "--output", str(self.output_file),
            ])
        return rc, out_buf.getvalue(), err_buf.getvalue()

    def test_opted_in_uses_copilot_engine(self):
        self._enable_copilot()
        with patch.object(changelog_manager.subprocess, "run", return_value=_completed(VALID_SUMMARY)):
            rc, out, _ = self._run_capture()
        self.assertEqual(rc, 0)
        payload = _last_json_line(out)
        self.assertEqual(payload["engine"], "copilot")
        self.assertTrue(payload["ok"])
        self.assertEqual(self.output_file.read_text(encoding="utf-8"), VALID_SUMMARY)

    def test_opted_out_never_spawns_copilot_even_with_token(self):
        changelog_manager.os.environ["GITHUB_TOKEN"] = "ghs_test"
        with patch.object(changelog_manager.subprocess, "run") as mock_run:
            rc, out, _ = self._run_capture()
        self.assertEqual(rc, 0)
        mock_run.assert_not_called()
        self.assertEqual(_last_json_line(out)["engine"], "fallback")

    def test_copilot_flag_false_or_missing_token_never_spawns(self):
        changelog_manager.os.environ.update({"COPILOT_AI": "false", "GITHUB_TOKEN": "ghs_test"})
        with patch.object(changelog_manager.subprocess, "run") as mock_run:
            self._run_capture()
        mock_run.assert_not_called()

        changelog_manager.os.environ.pop("GITHUB_TOKEN")
        changelog_manager.os.environ["COPILOT_AI"] = "true"
        with patch.object(changelog_manager.subprocess, "run") as mock_run:
            self._run_capture()
        mock_run.assert_not_called()

    def test_invalid_format_falls_back(self):
        self._enable_copilot()
        for bad in ("", "요약입니다. 로그인이 추가되었습니다.", "```markdown\n" + VALID_SUMMARY + "```"):
            with self.subTest(bad=bad[:20]):
                with patch.object(changelog_manager.subprocess, "run", return_value=_completed(bad)):
                    rc, out, err = self._run_capture()
                self.assertEqual(rc, 0)
                self.assertEqual(_last_json_line(out)["engine"], "fallback")
                self.assertIn("[warn] copilot failed", err)

    def test_cli_failures_fall_back_with_exit_code_zero(self):
        self._enable_copilot()
        failures = (
            FileNotFoundError("copilot"),
            subprocess.TimeoutExpired(cmd="copilot", timeout=90),
            _completed("", returncode=1, stderr="Error: Authentication failed"),
        )
        for failure in failures:
            with self.subTest(failure=type(failure).__name__):
                kwargs = {"side_effect": failure} if isinstance(failure, Exception) else {"return_value": failure}
                with patch.object(changelog_manager.subprocess, "run", **kwargs):
                    rc, out, err = self._run_capture()
                self.assertEqual(rc, 0)
                payload = _last_json_line(out)
                self.assertEqual(payload["engine"], "fallback")
                self.assertTrue(payload["ok"])
                self.assertIn("[warn] copilot failed", err)

    def test_user_api_key_without_url_and_model_is_skipped_with_warning(self):
        changelog_manager.os.environ["AI_API_KEY"] = "sk-user-key"
        with patch.object(changelog_manager.urllib.request, "urlopen") as mock_urlopen:
            rc, out, err = self._run_capture()
        self.assertEqual(rc, 0)
        mock_urlopen.assert_not_called()
        self.assertEqual(_last_json_line(out)["engine"], "fallback")
        self.assertIn("::warning::", err)
        self.assertNotIn("::warning::", out)

    def test_partial_user_api_settings_are_skipped(self):
        for env in (
            {"AI_API_KEY": "sk", "AI_API_BASE_URL": "https://api.example.com/v1"},
            {"AI_API_KEY": "sk", "AI_MODEL": "m"},
        ):
            with self.subTest(env=sorted(env)):
                with patch.dict(changelog_manager.os.environ, env):
                    with patch.object(changelog_manager.urllib.request, "urlopen") as mock_urlopen:
                        self._run_capture()
                mock_urlopen.assert_not_called()

    def test_skipped_user_api_lets_copilot_run(self):
        changelog_manager.os.environ["AI_API_KEY"] = "sk-user-key"
        self._enable_copilot()
        with patch.object(changelog_manager.subprocess, "run", return_value=_completed(VALID_SUMMARY)):
            _, out, err = self._run_capture()
        self.assertEqual(_last_json_line(out)["engine"], "copilot")
        self.assertIn("::warning::", err)

    def test_user_api_failure_chains_to_copilot(self):
        changelog_manager.os.environ.update({
            "AI_API_KEY": "sk", "AI_API_BASE_URL": "https://api.example.com/v1", "AI_MODEL": "m",
        })
        self._enable_copilot()
        with patch.object(changelog_manager.urllib.request, "urlopen", side_effect=URLError("refused")):
            with patch.object(changelog_manager.subprocess, "run", return_value=_completed(VALID_SUMMARY)):
                _, out, err = self._run_capture()
        self.assertEqual(_last_json_line(out)["engine"], "copilot")
        self.assertIn("[warn] user-api failed", err)


if __name__ == "__main__":
    unittest.main()
