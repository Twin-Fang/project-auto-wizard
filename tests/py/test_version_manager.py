import contextlib
import io as _io
import os
import subprocess
import sys
import shutil
import tempfile
import unittest
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parents[2] / "payload" / "scripts"
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

import version_manager  # noqa: E402

SCRIPT = Path(__file__).resolve().parents[2] / "payload" / "scripts" / "version_manager.py"
FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"

def run(args, cwd):
    return subprocess.run([sys.executable, str(SCRIPT), *args],
                          cwd=cwd, capture_output=True, text=True)

class TestCore(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        shutil.copytree(FIXTURES / "basic", self.tmp, dirs_exist_ok=True)

    def test_get_returns_version(self):
        r = run(["get"], self.tmp)
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip().splitlines()[-1], "0.1.0")

    def test_set_updates_version_and_preserves_comments(self):
        run(["set", "2.3.4"], self.tmp)
        text = (Path(self.tmp) / "version.yml").read_text(encoding="utf-8")
        self.assertIn('version: "2.3.4"', text)
        self.assertIn("# ===", text)

    def test_increment_bumps_patch(self):
        run(["increment"], self.tmp)
        r = run(["get"], self.tmp)
        self.assertEqual(r.stdout.strip().splitlines()[-1], "0.1.1")

    def test_get_code_and_increment_code(self):
        self.assertEqual(run(["get-code"], self.tmp).stdout.strip().splitlines()[-1], "1")
        run(["increment-code"], self.tmp)
        self.assertEqual(run(["get-code"], self.tmp).stdout.strip().splitlines()[-1], "2")

    def test_set_rejects_bad_semver(self):
        r = run(["set", "abc"], self.tmp)
        self.assertNotEqual(r.returncode, 0)

    def test_increment_also_bumps_version_code(self):
        # bash contract: increment = patch+1 AND version_code+1
        # (version_manager.sh calls increment_version_code after update_all_versions)
        run(["increment"], self.tmp)
        r = run(["get-code"], self.tmp)
        self.assertEqual(r.stdout.strip().splitlines()[-1], "2")

    def test_get_code_inserts_missing_version_code(self):
        yml = Path(self.tmp) / "version.yml"
        text = yml.read_text(encoding="utf-8")
        text = "\n".join(l for l in text.splitlines()
                         if not l.startswith("version_code:")) + "\n"
        yml.write_text(text, encoding="utf-8")

        r = run(["get-code"], self.tmp)
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip().splitlines()[-1], "1")
        self.assertIn("version_code: 1", yml.read_text(encoding="utf-8"))

    def test_lf_file_stays_lf_after_set(self):
        yml = Path(self.tmp) / "version.yml"
        # force pure LF on disk
        raw = yml.read_bytes().replace(b"\r\n", b"\n")
        yml.write_bytes(raw)

        run(["set", "2.3.4"], self.tmp)
        data = yml.read_bytes()
        self.assertNotIn(b"\r\n", data)
        self.assertIn(b'version: "2.3.4"', data)

    def test_crlf_file_stays_crlf_after_set(self):
        yml = Path(self.tmp) / "version.yml"
        # force pure CRLF on disk
        raw = yml.read_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
        yml.write_bytes(raw)

        run(["set", "2.3.4"], self.tmp)
        data = yml.read_bytes()
        self.assertNotIn(b"\r\r", data)
        # every LF must be preceded by CR (pure CRLF file)
        self.assertEqual(data.count(b"\n"), data.count(b"\r\n"))
        self.assertGreater(data.count(b"\r\n"), 0)
        self.assertIn(b'version: "2.3.4"', data)


class TestProjectTypesParsing(unittest.TestCase):
    """issue #62 — 템플릿이 붙이는 인라인 주석 때문에 project_types 파싱이 늘 실패했고,
    단수 키 폴백이 그 사실을 가려주고 있었다. 폴백이 사라진 지금은 회귀가 곧 배포 실패다."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.cwd = Path.cwd()
        os.chdir(self.tmp)
        self.addCleanup(os.chdir, self.cwd)

    def _write(self, body):
        Path("version.yml").write_text(body, encoding="utf-8")

    def test_inline_array_with_trailing_comment(self):
        self._write('version: "1.0.0"\nproject_types: ["node"] # first entry is primary\n')
        self.assertEqual(version_manager.get_project_types_csv(), ["node"])

    def test_inline_array_without_comment(self):
        self._write('version: "1.0.0"\nproject_types: ["flutter", "spring"]\n')
        self.assertEqual(version_manager.get_project_types_csv(), ["flutter", "spring"])

    def test_block_list_with_trailing_comment(self):
        self._write('version: "1.0.0"\nproject_types:\n  - "flutter" # app\n  - "spring"\n')
        self.assertEqual(version_manager.get_project_types_csv(), ["flutter", "spring"])

    def test_missing_key_returns_empty(self):
        self._write('version: "1.0.0"\n')
        self.assertEqual(version_manager.get_project_types_csv(), [])


class TestSetVersionCodeRegressionGuard(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.cwd = Path.cwd()
        os.chdir(self.tmp)
        self.addCleanup(os.chdir, self.cwd)
        Path("version.yml").write_text('version: "1.0.0"\nversion_code: 71\n', encoding="utf-8")

    def test_lower_code_still_written_but_warns(self):
        stderr = _io.StringIO()
        with contextlib.redirect_stderr(stderr):
            version_manager.set_version_code(2)
        self.assertIn("version_code: 2", Path("version.yml").read_text(encoding="utf-8"))
        self.assertIn("WARNING", stderr.getvalue())
        self.assertIn("71", stderr.getvalue())

    def test_higher_code_written_without_warning(self):
        stderr = _io.StringIO()
        with contextlib.redirect_stderr(stderr):
            version_manager.set_version_code(72)
        self.assertIn("version_code: 72", Path("version.yml").read_text(encoding="utf-8"))
        self.assertNotIn("WARNING", stderr.getvalue())
