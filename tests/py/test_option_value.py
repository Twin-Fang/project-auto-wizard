"""Boolean option values in version.yml: the shared case table is run by the Node CLI reader as well
(tests/node/option-value-parity.test.js), so both must give the same answer for every row."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parents[2] / "payload" / "scripts"
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

import version_manager  # noqa: E402

CASES = json.loads(
    (Path(__file__).resolve().parents[1] / "fixtures" / "option-value-cases.json").read_text(encoding="utf-8")
)
SCRIPT = _SCRIPT_DIR / "version_manager.py"


class OptionValueTable(unittest.TestCase):
    def test_every_case(self):
        for c in CASES:
            with self.subTest(c["name"]):
                # CRLF files are normalized by read_file(); feed the same normalization here
                text = c["content"].replace("\r\n", "\n")
                value, raw = version_manager.read_option(c["key"], c["default"], text=text)
                self.assertEqual("true" if value else "false", c["expected"])
                self.assertEqual(raw, c["invalid"])


class OptionCommand(unittest.TestCase):
    """The `option` command as the workflows call it (stdout is the value, warnings go to stderr)."""

    def _run(self, content, *extra):
        with tempfile.TemporaryDirectory() as d:
            if content is not None:
                # newline="" keeps CRLF exactly as the table has it
                with open(os.path.join(d, "version.yml"), "w", encoding="utf-8", newline="") as f:
                    f.write(content)
            env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8", "PROJECT_AUTO_WIZARD_LANG": "en"}
            return subprocess.run(
                [sys.executable, str(SCRIPT), "option", "release_automerge", *extra],
                cwd=d, env=env, capture_output=True, text=True, encoding="utf-8",
            )

    def test_table_through_the_command(self):
        for c in CASES:
            with self.subTest(c["name"]):
                r = self._run(c["content"], "--default", "true" if c["default"] else "false")
                self.assertEqual(r.returncode, 0, r.stderr)
                self.assertEqual(r.stdout.strip(), c["expected"])
                # a warning appears exactly when the value was written but not recognized
                self.assertEqual("::warning::" in r.stderr, c["invalid"] is not None, r.stderr)

    def test_missing_file_prints_the_default(self):
        self.assertEqual(self._run(None, "--default", "true").stdout.strip(), "true")
        self.assertEqual(self._run(None, "--default", "false").stdout.strip(), "false")
        self.assertEqual(self._run(None).stdout.strip(), "false")

    def test_warning_names_the_key_and_the_value(self):
        r = self._run("metadata:\n  template:\n    options:\n      release_automerge: maybe\n")
        self.assertIn("release_automerge", r.stderr)
        self.assertIn("maybe", r.stderr)


class ParseOptionValue(unittest.TestCase):
    def test_recognized_and_not(self):
        for raw, want in [("true", True), ("FALSE", False), ("'true'", True), ('"False" # x', False),
                          ("yes", None), ("", None), ("0", None), ("null", None), ("true#x", None)]:
            with self.subTest(raw):
                self.assertIs(version_manager.parse_option_value(raw), want)


if __name__ == "__main__":
    unittest.main()
