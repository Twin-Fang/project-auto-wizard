import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock
from urllib.error import HTTPError

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

    def _run_main(self, extra_args=None):
        args = [
            "ai-summary",
            "--commits-file", str(self.commits_file),
            "--version", "1.2.3",
            "--output", str(self.output_file),
        ]
        if extra_args:
            args += extra_args
        return changelog_manager.main(args)

    def test_user_api_key_success(self):
        changelog_manager.os.environ["AI_API_KEY"] = "sk-user-key"

        mock_resp = _mock_response({
            "choices": [{"message": {"content": "## Release summary\n주요 변경 사항입니다."}}]
        })

        with patch.object(changelog_manager.urllib.request, "urlopen", return_value=mock_resp) as mock_urlopen:
            rc = self._run_main()

        self.assertEqual(rc, 0)
        self.assertTrue(mock_urlopen.called)

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
            rc = self._run_main()

        self.assertEqual(rc, 0)
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
            rc = self._run_main()

        self.assertEqual(rc, 0)
        self.assertTrue(self.output_file.is_file())
        content = self.output_file.read_text(encoding="utf-8")
        self.assertTrue(len(content.strip()) > 0)
        self.assertIn("1.2.3", content)

    def test_no_env_uses_fallback_and_never_calls_network(self):
        with patch.object(changelog_manager.urllib.request, "urlopen") as mock_urlopen:
            rc = self._run_main()

        self.assertEqual(rc, 0)
        mock_urlopen.assert_not_called()
        content = self.output_file.read_text(encoding="utf-8")
        self.assertTrue(len(content.strip()) > 0)

    def test_pr_title_included_in_prompt(self):
        changelog_manager.os.environ["AI_API_KEY"] = "sk-user-key"
        mock_resp = _mock_response({
            "choices": [{"message": {"content": "summary text"}}]
        })

        with patch.object(changelog_manager.urllib.request, "urlopen", return_value=mock_resp) as mock_urlopen:
            rc = self._run_main(["--pr-title", "Add awesome new feature"])

        self.assertEqual(rc, 0)
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


if __name__ == "__main__":
    unittest.main()
