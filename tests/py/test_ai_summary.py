import contextlib
import io
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock
from urllib.error import HTTPError, URLError

SCRIPT_DIR = Path(__file__).resolve().parents[2] / "payload" / "scripts"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import changelog_manager  # noqa: E402


def _mock_response(body_dict):
    """Build a mock object usable as a context manager returned by urlopen()."""
    m = MagicMock()
    m.read.return_value = json.dumps(body_dict).encode("utf-8")
    m.__enter__.return_value = m
    m.__exit__.return_value = False
    return m


def _last_json_line(text):
    line = [l for l in text.splitlines() if l.strip()][-1]
    return json.loads(line)


class TestAiSummary(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.commits_file = Path(self.tmp) / "commits.txt"
        self.commits_file.write_text("feat: add login\nfix: crash on start\n", encoding="utf-8")
        self.output_file = Path(self.tmp) / "summary.md"

        self.env_patcher = patch.dict(
            changelog_manager.os.environ,
            {},
            clear=True,
        )
        self.env_patcher.start()
        self.addCleanup(self.env_patcher.stop)

    def _run_main(self, extra_args=None, output=None):
        args = [
            "ai-summary",
            "--commits-file", str(self.commits_file),
            "--version", "1.2.3",
            "--output", str(output if output is not None else self.output_file),
        ]
        if extra_args:
            args += extra_args
        return changelog_manager.main(args)

    def _run_main_capture(self, extra_args=None, output=None):
        """Run main() capturing stdout/stderr; return (rc, stdout JSON payload, stderr)."""
        out_buf, err_buf = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out_buf), contextlib.redirect_stderr(err_buf):
            rc = self._run_main(extra_args, output=output)
        return rc, _last_json_line(out_buf.getvalue()), err_buf.getvalue()

    def test_user_api_key_success(self):
        changelog_manager.os.environ["AI_API_KEY"] = "sk-user-key"

        mock_resp = _mock_response({
            "choices": [{"message": {"content": "## Release summary\n주요 변경 사항입니다."}}]
        })

        with patch.object(changelog_manager.urllib.request, "urlopen", return_value=mock_resp) as mock_urlopen:
            rc, payload, _ = self._run_main_capture()

        self.assertEqual(rc, 0)
        self.assertTrue(mock_urlopen.called)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["engine"], "user-api")

        req = mock_urlopen.call_args[0][0]
        self.assertEqual(req.get_header("Authorization"), "Bearer sk-user-key")
        body = json.loads(req.data.decode("utf-8"))
        self.assertIn("model", body)
        self.assertEqual(body["messages"][0]["role"], "user")

        self.assertTrue(self.output_file.is_file())
        content = self.output_file.read_text(encoding="utf-8")
        self.assertIn("주요 변경 사항입니다.", content)

    def test_github_token_fallback_to_models_endpoint(self):
        changelog_manager.os.environ["GITHUB_TOKEN"] = "ghp_test_token"

        mock_resp = _mock_response({
            "choices": [{"message": {"content": "github models summary"}}]
        })

        with patch.object(changelog_manager.urllib.request, "urlopen", return_value=mock_resp) as mock_urlopen:
            rc, payload, _ = self._run_main_capture()

        self.assertEqual(rc, 0)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["engine"], "github-models")
        req = mock_urlopen.call_args[0][0]
        self.assertIn("models.github.ai", req.full_url)
        self.assertEqual(req.get_header("Authorization"), "Bearer ghp_test_token")

        content = self.output_file.read_text(encoding="utf-8")
        self.assertIn("github models summary", content)

    def test_http_error_429_falls_back_to_rule_based(self):
        changelog_manager.os.environ["AI_API_KEY"] = "sk-user-key"

        http_error = HTTPError(
            url="https://models.github.ai/inference/chat/completions",
            code=429,
            msg="Too Many Requests",
            hdrs=None,
            fp=None,
        )

        with patch.object(changelog_manager.urllib.request, "urlopen", side_effect=http_error):
            rc, payload, _ = self._run_main_capture()

        self.assertEqual(rc, 0)
        self.assertEqual(payload["engine"], "fallback")
        self.assertTrue(self.output_file.is_file())
        content = self.output_file.read_text(encoding="utf-8")
        self.assertTrue(len(content.strip()) > 0)
        self.assertIn("1.2.3", content)

    def test_no_env_uses_fallback_and_never_calls_network(self):
        with patch.object(changelog_manager.urllib.request, "urlopen") as mock_urlopen:
            rc, payload, _ = self._run_main_capture()

        self.assertEqual(rc, 0)
        self.assertEqual(payload["engine"], "fallback")
        mock_urlopen.assert_not_called()
        content = self.output_file.read_text(encoding="utf-8")
        self.assertTrue(len(content.strip()) > 0)

    def test_pr_title_included_in_prompt(self):
        changelog_manager.os.environ["AI_API_KEY"] = "sk-user-key"
        mock_resp = _mock_response({
            "choices": [{"message": {"content": "summary text"}}]
        })

        with patch.object(changelog_manager.urllib.request, "urlopen", return_value=mock_resp) as mock_urlopen:
            rc, payload, _ = self._run_main_capture(["--pr-title", "Add awesome new feature"])

        self.assertEqual(rc, 0)
        self.assertEqual(payload["engine"], "user-api")
        req = mock_urlopen.call_args[0][0]
        body = json.loads(req.data.decode("utf-8"))
        self.assertIn("Add awesome new feature", body["messages"][0]["content"])

    def test_stdout_json_line_reports_engine(self):
        with patch.object(changelog_manager.urllib.request, "urlopen"):
            with patch("sys.stdout") as mock_stdout:
                self._run_main()

        # Collect what was written to stdout across all write() calls.
        written = "".join(call.args[0] for call in mock_stdout.write.call_args_list if call.args)
        # Find last non-empty JSON-looking line.
        line = [l for l in written.splitlines() if l.strip()][-1]
        payload = json.loads(line)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["engine"], "fallback")
        self.assertIn("output", payload)

    # ---------------- output-write contract (Critical 1) ----------------

    def test_output_write_failure_reports_ok_false_and_salvages_to_stderr(self):
        # Output path is an existing DIRECTORY -> open(..., 'w') raises.
        unwritable = Path(self.tmp) / "outdir"
        unwritable.mkdir()

        with patch.object(changelog_manager.urllib.request, "urlopen") as mock_urlopen:
            rc, payload, stderr = self._run_main_capture(output=unwritable)

        self.assertEqual(rc, 0)  # exit code stays 0
        mock_urlopen.assert_not_called()
        self.assertFalse(payload["ok"])  # ok must reflect write failure
        self.assertEqual(payload["engine"], "fallback")
        self.assertIn("output", payload)
        # Summary text salvaged to stderr (fallback md contains the version header).
        self.assertIn("1.2.3", stderr)

    # ---------------- engine chain robustness (Important 2 & 4) ----------------

    def test_empty_content_200_falls_back(self):
        changelog_manager.os.environ["AI_API_KEY"] = "sk-user-key"
        mock_resp = _mock_response({
            "choices": [{"message": {"content": "   "}}]
        })

        with patch.object(changelog_manager.urllib.request, "urlopen", return_value=mock_resp):
            rc, payload, _ = self._run_main_capture()

        self.assertEqual(rc, 0)
        self.assertEqual(payload["engine"], "fallback")
        content = self.output_file.read_text(encoding="utf-8")
        self.assertTrue(len(content.strip()) > 0)

    def test_tier1_failure_chains_to_github_models(self):
        changelog_manager.os.environ["AI_API_KEY"] = "sk-user-key"
        changelog_manager.os.environ["GITHUB_TOKEN"] = "ghp_test_token"

        mock_resp = _mock_response({
            "choices": [{"message": {"content": "tier2 summary"}}]
        })
        side_effects = [URLError("connection refused"), mock_resp]

        with patch.object(changelog_manager.urllib.request, "urlopen", side_effect=side_effects) as mock_urlopen:
            rc, payload, stderr = self._run_main_capture()

        self.assertEqual(rc, 0)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["engine"], "github-models")
        self.assertEqual(mock_urlopen.call_count, 2)
        second_req = mock_urlopen.call_args_list[1][0][0]
        self.assertIn("models.github.ai", second_req.full_url)
        self.assertEqual(second_req.get_header("Authorization"), "Bearer ghp_test_token")
        self.assertIn("[warn] user-api failed", stderr)
        self.assertEqual(self.output_file.read_text(encoding="utf-8"), "tier2 summary")

    def test_malformed_body_missing_choices_falls_back(self):
        changelog_manager.os.environ["AI_API_KEY"] = "sk-user-key"
        mock_resp = _mock_response({"error": "something went wrong"})

        with patch.object(changelog_manager.urllib.request, "urlopen", return_value=mock_resp):
            rc, payload, _ = self._run_main_capture()

        self.assertEqual(rc, 0)
        self.assertEqual(payload["engine"], "fallback")
        content = self.output_file.read_text(encoding="utf-8")
        self.assertTrue(len(content.strip()) > 0)

    def test_urlerror_falls_back(self):
        changelog_manager.os.environ["GITHUB_TOKEN"] = "ghp_test_token"

        with patch.object(changelog_manager.urllib.request, "urlopen", side_effect=URLError("timed out")):
            rc, payload, stderr = self._run_main_capture()

        self.assertEqual(rc, 0)
        self.assertEqual(payload["engine"], "fallback")
        self.assertIn("[warn] github-models failed", stderr)
        content = self.output_file.read_text(encoding="utf-8")
        self.assertTrue(len(content.strip()) > 0)


if __name__ == "__main__":
    unittest.main()
