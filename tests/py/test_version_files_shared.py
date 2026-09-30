"""Checks that release-time version reading (version_manager.py) reads the shared version-file examples as expected.

The same examples and expected values (tests/fixtures/version-files/expected.json) are used by the Node test
(tests/node/version-files-shared.test.js), so if install-time detection and release-time reading
diverge, one of the two fails.
"""
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parents[2] / "payload" / "scripts"
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

import version_manager  # noqa: E402

ROOT = Path(__file__).resolve().parents[1] / "fixtures" / "version-files"
CASES = json.loads((ROOT / "expected.json").read_text(encoding="utf-8"))["cases"]

# A missing version in the file falls back to the version.yml value, so use a non-version marker to tell them apart.
FALLBACK = "not-from-project-file"


class TestSharedVersionFiles(unittest.TestCase):
    def test_case_dirs_match_expected(self):
        dirs = sorted(p.name for p in ROOT.iterdir() if p.is_dir())
        self.assertEqual(dirs, sorted(CASES))

    def test_cases(self):
        for name, case in CASES.items():
            with self.subTest(case=name):
                self._check(name, case)

    def _check(self, name, case):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        shutil.copytree(ROOT / name, tmp, dirs_exist_ok=True)
        (Path(tmp) / "version.yml").write_text(
            f'version: "{FALLBACK}"\nproject_types: ["{case["type"]}"]\n', encoding="utf-8")
        # version_manager works off the version.yml in the current directory.
        cwd = os.getcwd()
        os.chdir(tmp)
        try:
            with contextlib.redirect_stderr(io.StringIO()):
                version = version_manager.get_project_file_version(case["type"])
                build_number = version_manager._pubspec_build_number(".")
        finally:
            os.chdir(cwd)

        self.assertEqual(None if version == FALLBACK else version, case["version"])
        # Python reads the build number from pubspec.yaml only.
        if case["type"] == "flutter":
            self.assertEqual(build_number, case["buildNumber"])


if __name__ == "__main__":
    unittest.main()
