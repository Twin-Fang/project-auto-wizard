import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "payload" / "scripts" / "changelog_manager.py"


def run(args, cwd):
    return subprocess.run([sys.executable, str(SCRIPT), *args],
                          cwd=cwd, capture_output=True, text=True)


class TestGenerateMd(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def test_generate_md_from_seed_changelog_json(self):
        seed = {
            "metadata": {
                "lastUpdated": "2026-01-01T00:00:00Z",
                "currentVersion": "1.2.3",
                "projectType": "spring",
                "projectTypes": ["spring"],
                "totalReleases": 1,
            },
            "releases": [
                {
                    "version": "1.2.3",
                    "project_type": "spring",
                    "project_types": ["spring"],
                    "date": "2026-01-01",
                    "pr_number": 42,
                    "raw_summary": "Initial release",
                    "parsed_changes": {
                        "features": {
                            "title": "Features",
                            "items": ["Add login"],
                        }
                    },
                    "parse_method": "markdown",
                }
            ],
        }
        (Path(self.tmp) / "CHANGELOG.json").write_text(
            json.dumps(seed, indent=2, ensure_ascii=False), encoding="utf-8"
        )

        r = run(["generate-md"], self.tmp)
        self.assertEqual(r.returncode, 0, msg=r.stderr)

        md_path = Path(self.tmp) / "CHANGELOG.md"
        self.assertTrue(md_path.is_file())
        content = md_path.read_text(encoding="utf-8")
        self.assertIn("1.2.3", content)
        self.assertIn("Add login", content)


if __name__ == "__main__":
    unittest.main()
