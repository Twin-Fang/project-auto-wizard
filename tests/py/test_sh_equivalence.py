"""Behavioral equivalence harness: compares payload/scripts/version_manager.py
against the bash reference version_manager.sh (SUH-DEVOPS-TEMPLATE).

Skipped unless:
  - env var PROJECTOPS_SH_REF points to the bash script, AND
  - `bash` is available on PATH.

The bash reference also requires `yq` and `jq` to be installed (see the
script's own header) — if those are missing, the sh side will fail and this
test will report the mismatch rather than silently skip, since that's a
real environment gap the caller should know about.

Usage:
  PROJECTOPS_SH_REF=/path/to/version_manager.sh python -m unittest tests.py.test_sh_equivalence -v

Bash is the source of truth: any mismatch found here should be fixed on the
Python side, never by "adjusting" the bash reference (read-only).
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

PY_SCRIPT = Path(__file__).resolve().parents[2] / "payload" / "scripts" / "version_manager.py"
FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"

SH_REF = os.environ.get("PROJECTOPS_SH_REF")
BASH_AVAILABLE = shutil.which("bash") is not None

SKIP_REASON = None
if not SH_REF:
    SKIP_REASON = "PROJECTOPS_SH_REF not set"
elif not Path(SH_REF).is_file():
    SKIP_REASON = f"PROJECTOPS_SH_REF does not point to a file: {SH_REF}"
elif not BASH_AVAILABLE:
    SKIP_REASON = "bash not found on PATH"


def run_py(args, cwd):
    return subprocess.run([sys.executable, str(PY_SCRIPT), *args],
                          cwd=cwd, capture_output=True, text=True)


def run_sh(args, cwd):
    # The bash script auto-detects `bash` via BASH_SOURCE guard and expects
    # to be invoked with version.yml present in cwd (its own usage docs run
    # it as `./version_manager.sh [command] [options]` from the repo root).
    return subprocess.run(["bash", SH_REF, *args],
                          cwd=cwd, capture_output=True, text=True)


def last_line(text):
    lines = text.strip().splitlines()
    return lines[-1] if lines else ""


@unittest.skipIf(SKIP_REASON is not None, SKIP_REASON or "")
class TestShEquivalence(unittest.TestCase):
    def _dual_tmp(self, fixture_name):
        sh_tmp = tempfile.mkdtemp(prefix="sh_")
        py_tmp = tempfile.mkdtemp(prefix="py_")
        self.addCleanup(shutil.rmtree, sh_tmp, ignore_errors=True)
        self.addCleanup(shutil.rmtree, py_tmp, ignore_errors=True)
        shutil.copytree(FIXTURES / fixture_name, sh_tmp, dirs_exist_ok=True)
        shutil.copytree(FIXTURES / fixture_name, py_tmp, dirs_exist_ok=True)
        return sh_tmp, py_tmp

    def test_get_matches(self):
        sh_tmp, py_tmp = self._dual_tmp("basic")
        sh_r = run_sh(["get"], sh_tmp)
        py_r = run_py(["get"], py_tmp)
        self.assertEqual(last_line(sh_r.stdout), last_line(py_r.stdout),
                          f"sh stderr:\n{sh_r.stderr}\npy stderr:\n{py_r.stderr}")

    def test_set_matches(self):
        sh_tmp, py_tmp = self._dual_tmp("basic")
        sh_r = run_sh(["set", "3.4.5"], sh_tmp)
        py_r = run_py(["set", "3.4.5"], py_tmp)
        self.assertEqual(last_line(sh_r.stdout), last_line(py_r.stdout))
        sh_yml = (Path(sh_tmp) / "version.yml").read_text(encoding="utf-8")
        py_yml = (Path(py_tmp) / "version.yml").read_text(encoding="utf-8")
        self.assertIn('version: "3.4.5"', sh_yml)
        self.assertIn('version: "3.4.5"', py_yml)

    def test_increment_matches(self):
        sh_tmp, py_tmp = self._dual_tmp("basic")
        sh_r = run_sh(["increment"], sh_tmp)
        py_r = run_py(["increment"], py_tmp)
        self.assertEqual(last_line(sh_r.stdout), last_line(py_r.stdout),
                          f"sh stderr:\n{sh_r.stderr}\npy stderr:\n{py_r.stderr}")

    def test_sync_matches_for_react(self):
        sh_tmp, py_tmp = self._dual_tmp("react")
        run_sh(["set", "2.2.2"], sh_tmp)
        run_py(["set", "2.2.2"], py_tmp)
        sh_r = run_sh(["sync"], sh_tmp)
        py_r = run_py(["sync"], py_tmp)
        self.assertEqual(last_line(sh_r.stdout), last_line(py_r.stdout))
        sh_pkg = json.loads((Path(sh_tmp) / "package.json").read_text(encoding="utf-8"))
        py_pkg = json.loads((Path(py_tmp) / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(sh_pkg["version"], py_pkg["version"])


if __name__ == "__main__":
    unittest.main()
