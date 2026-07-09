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


class TestUpdateFromSummaryDegenerateJson(unittest.TestCase):
    """실측 회귀 (dogfood PR #1): 스캐폴드가 만든 비정형 CHANGELOG.json({"versions": []})에서
    update-from-summary가 KeyError: 'metadata'로 죽던 버그."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def test_existing_json_without_metadata_key(self):
        import os
        Path(self.tmp, "CHANGELOG.json").write_text('{"versions": []}', encoding="utf-8")
        Path(self.tmp, "pr_body.md").write_text("### Features\n- add thing\n", encoding="utf-8")
        env = {**os.environ,
               "VERSION": "0.1.3", "PROJECT_TYPE": "node", "PROJECT_TYPES": "node",
               "TODAY": "2026-07-09", "PR_NUMBER": "1", "TIMESTAMP": "2026-07-09T00:00:00Z",
               "PYTHONIOENCODING": "utf-8"}
        r = subprocess.run([sys.executable, str(SCRIPT), "update-from-summary"],
                           cwd=self.tmp, capture_output=True, text=True,
                           encoding="utf-8", env=env)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        data = json.loads(Path(self.tmp, "CHANGELOG.json").read_text(encoding="utf-8"))
        self.assertEqual(data["metadata"]["currentVersion"], "0.1.3")
        self.assertEqual(len(data["releases"]), 1)
