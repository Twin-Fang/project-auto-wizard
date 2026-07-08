import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "payload" / "scripts" / "version_manager.py"
FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"


def run(args, cwd):
    return subprocess.run([sys.executable, str(SCRIPT), *args],
                          cwd=cwd, capture_output=True, text=True)


class SyncTestCase(unittest.TestCase):
    def make_tmp(self, fixture_name):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        shutil.copytree(FIXTURES / fixture_name, tmp, dirs_exist_ok=True)
        return tmp


class TestSyncSpring(SyncTestCase):
    def test_sync_updates_build_gradle(self):
        tmp = self.make_tmp("spring")
        run(["set", "1.2.3"], tmp)
        r = run(["sync"], tmp)
        self.assertEqual(r.returncode, 0)
        text = (Path(tmp) / "build.gradle").read_text(encoding="utf-8")
        self.assertIn("version = '1.2.3'", text)

    def test_sync_leaves_plugin_version_line_untouched(self):
        tmp = self.make_tmp("spring")
        run(["set", "1.2.3"], tmp)
        run(["sync"], tmp)
        text = (Path(tmp) / "build.gradle").read_text(encoding="utf-8")
        # plugin DSL `id '...' version '...'` has no `=` and must not be rewritten
        self.assertIn("id 'org.springframework.boot' version '3.2.0'", text)

    def test_sync_updates_kts_double_quote_variant(self):
        tmp = self.make_tmp("spring-kts")
        run(["set", "1.2.3"], tmp)
        r = run(["sync"], tmp)
        self.assertEqual(r.returncode, 0)
        text = (Path(tmp) / "build.gradle.kts").read_text(encoding="utf-8")
        self.assertIn('version = "1.2.3"', text)


class TestSyncFlutter(SyncTestCase):
    def test_sync_updates_pubspec_with_build_number(self):
        tmp = self.make_tmp("flutter")
        run(["set", "1.2.3"], tmp)
        r = run(["sync"], tmp)
        self.assertEqual(r.returncode, 0)
        text = (Path(tmp) / "pubspec.yaml").read_text(encoding="utf-8")
        self.assertIn("version: 1.2.3+1", text)


class TestSyncReact(SyncTestCase):
    def test_sync_updates_package_json(self):
        tmp = self.make_tmp("react")
        run(["set", "1.2.3"], tmp)
        r = run(["sync"], tmp)
        self.assertEqual(r.returncode, 0)
        data = json.loads((Path(tmp) / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(data["version"], "1.2.3")

    def test_sync_preserves_non_ascii_description(self):
        tmp = self.make_tmp("react")
        run(["set", "1.2.3"], tmp)
        r = run(["sync"], tmp)
        self.assertEqual(r.returncode, 0)
        raw = (Path(tmp) / "package.json").read_text(encoding="utf-8")
        # raw UTF-8 must survive — never \uXXXX escapes
        self.assertIn("한국어 설명 픽스처", raw)
        self.assertNotIn("\\ud55c", raw)


class TestSyncPython(SyncTestCase):
    def test_sync_updates_pyproject_toml(self):
        tmp = self.make_tmp("python-proj")
        run(["set", "1.2.3"], tmp)
        r = run(["sync"], tmp)
        self.assertEqual(r.returncode, 0)
        text = (Path(tmp) / "pyproject.toml").read_text(encoding="utf-8")
        self.assertIn('version = "1.2.3"', text)


class TestSyncReactNative(SyncTestCase):
    def test_sync_updates_plist_and_gradle(self):
        tmp = self.make_tmp("react-native")
        run(["set", "1.2.3"], tmp)
        r = run(["sync"], tmp)
        self.assertEqual(r.returncode, 0)
        plist_text = (Path(tmp) / "ios" / "App" / "Info.plist").read_text(encoding="utf-8")
        self.assertIn("<string>1.2.3</string>", plist_text)
        gradle_text = (Path(tmp) / "android" / "app" / "build.gradle").read_text(encoding="utf-8")
        self.assertIn('versionName "1.2.3"', gradle_text)


class TestSyncExpo(SyncTestCase):
    def test_sync_updates_app_json_expo_version(self):
        tmp = self.make_tmp("react-native-expo")
        run(["set", "1.2.3"], tmp)
        r = run(["sync"], tmp)
        self.assertEqual(r.returncode, 0)
        data = json.loads((Path(tmp) / "app.json").read_text(encoding="utf-8"))
        self.assertEqual(data["expo"]["version"], "1.2.3")


class TestSyncMonorepo(SyncTestCase):
    def test_sync_updates_both_subdir_files(self):
        tmp = self.make_tmp("monorepo")
        run(["set", "1.2.3"], tmp)
        r = run(["sync"], tmp)
        self.assertEqual(r.returncode, 0)

        pubspec_text = (Path(tmp) / "app" / "pubspec.yaml").read_text(encoding="utf-8")
        self.assertIn("version: 1.2.3+1", pubspec_text)

        pkg_data = json.loads((Path(tmp) / "client" / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(pkg_data["version"], "1.2.3")


class TestSyncMissingTargetFile(SyncTestCase):
    def test_missing_target_file_warns_but_exits_zero(self):
        tmp = self.make_tmp("missing-target")
        run(["set", "1.2.3"], tmp)
        r = run(["sync"], tmp)
        self.assertEqual(r.returncode, 0)
        self.assertFalse((Path(tmp) / "pyproject.toml").exists())


if __name__ == "__main__":
    unittest.main()
