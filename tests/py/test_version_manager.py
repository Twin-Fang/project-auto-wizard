import subprocess, sys, shutil, tempfile, unittest
from pathlib import Path

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
