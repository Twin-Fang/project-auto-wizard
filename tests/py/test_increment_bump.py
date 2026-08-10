import contextlib
import io
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[2] / "payload" / "scripts"
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import version_manager  # noqa: E402


class TestIncrementVersion(unittest.TestCase):
    def test_default_bump_is_patch(self):
        self.assertEqual(version_manager.increment_version("1.2.3"), "1.2.4")

    def test_explicit_patch(self):
        self.assertEqual(version_manager.increment_version("1.2.3", "patch"), "1.2.4")

    def test_minor_resets_patch_to_zero(self):
        self.assertEqual(version_manager.increment_version("1.2.3", "minor"), "1.3.0")

    def test_major_resets_minor_and_patch_to_zero(self):
        self.assertEqual(version_manager.increment_version("1.2.3", "major"), "2.0.0")

    def test_matches_increment_patch_for_default(self):
        self.assertEqual(version_manager.increment_version("0.1.5"), version_manager.increment_patch("0.1.5"))


class TestCmdIncrementBumpFlag(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.cwd = Path.cwd()
        import os
        os.chdir(self.tmp)
        self.addCleanup(os.chdir, self.cwd)
        # project_types는 필수 키다 (issue #62) — 없으면 sync가 명시적으로 실패한다
        Path("version.yml").write_text(
            'version: "1.0.0"\nversion_code: 1\nproject_types: ["basic"]\n', encoding="utf-8")

    def _run(self, extra_args=None):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = version_manager.main(["increment"] + (extra_args or []))
        return rc, out.getvalue().strip().splitlines()[-1]

    def test_no_bump_flag_defaults_to_patch(self):
        rc, last_line = self._run()
        self.assertEqual(rc, 0)
        self.assertEqual(last_line, "1.0.1")

    def test_bump_minor(self):
        rc, last_line = self._run(["--bump", "minor"])
        self.assertEqual(rc, 0)
        self.assertEqual(last_line, "1.1.0")

    def test_bump_major(self):
        rc, last_line = self._run(["--bump", "major"])
        self.assertEqual(rc, 0)
        self.assertEqual(last_line, "2.0.0")


if __name__ == "__main__":
    unittest.main()
