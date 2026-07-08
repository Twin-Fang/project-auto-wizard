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
