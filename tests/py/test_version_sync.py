import json
import re
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


class TestSyncSpringDependencyVersions(SyncTestCase):
    def test_increment_leaves_kotlin_version_variable_untouched(self):
        tmp = self.make_tmp("spring")
        (Path(tmp) / "build.gradle").write_text(
            "buildscript {\n  ext.kotlin_version = '1.9.0'\n}\n"
            "version = '1.2.3'\n"
            "ext { compose_version = \"1.5.0\" }\n",
            encoding="utf-8",
        )
        run(["set", "1.2.3"], tmp)
        r = run(["increment"], tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.strip().splitlines()[-1], "1.2.4")
        text = (Path(tmp) / "build.gradle").read_text(encoding="utf-8")
        self.assertIn("version = '1.2.4'", text)
        self.assertIn("ext.kotlin_version = '1.9.0'", text)
        self.assertIn('compose_version = "1.5.0"', text)


POM = """<?xml version="1.0" encoding="UTF-8"?>
<project>
  <!-- <version>0.0.0</version> -->
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.4.0</version>
  </parent>
  <groupId>com.example</groupId>
  <artifactId>my-service</artifactId>
  <version>1.4.0</version>
  <dependencies>
    <dependency>
      <groupId>org.example</groupId>
      <artifactId>lib</artifactId>
      <version>1.4.0</version>
    </dependency>
  </dependencies>
</project>
"""

CHILD_POM = """<project>
  <parent>
    <groupId>com.example</groupId>
    <artifactId>my-service</artifactId>
    <version>1.4.0</version>
  </parent>
  <artifactId>my-service-api</artifactId>
</project>
"""


class TestSyncMaven(SyncTestCase):
    def make_maven(self):
        tmp = self.make_tmp("spring")
        (Path(tmp) / "build.gradle").unlink()
        (Path(tmp) / "pom.xml").write_text(POM, encoding="utf-8")
        (Path(tmp) / "api").mkdir()
        (Path(tmp) / "api" / "pom.xml").write_text(CHILD_POM, encoding="utf-8")
        return tmp

    def test_get_reads_project_version_from_pom(self):
        tmp = self.make_maven()
        r = run(["get"], tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.strip().splitlines()[-1], "1.4.0")

    def test_increment_updates_only_project_version(self):
        tmp = self.make_maven()
        run(["set", "1.4.0"], tmp)
        r = run(["increment"], tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.strip().splitlines()[-1], "1.4.1")
        text = (Path(tmp) / "pom.xml").read_text(encoding="utf-8")
        self.assertIn("<artifactId>my-service</artifactId>\n  <version>1.4.1</version>", text)
        # 부모 BOM·의존성·주석의 버전은 그대로
        self.assertIn("<version>3.4.0</version>", text)
        self.assertIn("<artifactId>lib</artifactId>\n      <version>1.4.0</version>", text)
        self.assertIn("<!-- <version>0.0.0</version> -->", text)
        child = (Path(tmp) / "api" / "pom.xml").read_text(encoding="utf-8")
        self.assertIn("<version>1.4.1</version>", child)

    def test_property_version_is_left_alone(self):
        tmp = self.make_maven()
        pom = Path(tmp) / "pom.xml"
        pom.write_text(POM.replace("<version>1.4.0</version>\n  <dependencies>",
                                   "<version>${revision}</version>\n  <dependencies>"), encoding="utf-8")
        run(["set", "2.0.0"], tmp)
        self.assertIn("<version>${revision}</version>", pom.read_text(encoding="utf-8"))


class TestSyncFlutter(SyncTestCase):
    def test_sync_updates_pubspec_with_build_number(self):
        tmp = self.make_tmp("flutter")
        run(["set", "1.2.3"], tmp)
        r = run(["sync"], tmp)
        self.assertEqual(r.returncode, 0)
        text = (Path(tmp) / "pubspec.yaml").read_text(encoding="utf-8")
        self.assertIn("version: 1.2.3+1", text)


class TestFlutterBuildNumberNeverRegresses(SyncTestCase):
    def make_flutter(self, pubspec_version):
        tmp = self.make_tmp("flutter")
        run(["set", "2.5.0"], tmp)
        pubspec = Path(tmp) / "pubspec.yaml"
        text = pubspec.read_text(encoding="utf-8")
        pubspec.write_text(re.sub(r"^version: .*$", f"version: {pubspec_version}", text, flags=re.M),
                           encoding="utf-8")
        return tmp, pubspec

    def test_get_and_sync_keep_higher_pubspec_build_number(self):
        tmp, pubspec = self.make_flutter("2.5.0+40")
        run(["get"], tmp)
        r = run(["sync"], tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("version: 2.5.0+40", pubspec.read_text(encoding="utf-8"))
        self.assertEqual(run(["get-code"], tmp).stdout.strip().splitlines()[-1], "40")

    def test_increment_uses_max_plus_one_and_writes_both(self):
        tmp, pubspec = self.make_flutter("2.5.0+100")
        r = run(["increment"], tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("version: 2.5.1+101", pubspec.read_text(encoding="utf-8"))
        self.assertIn("version_code: 101", (Path(tmp) / "version.yml").read_text(encoding="utf-8"))

    def test_increment_code_uses_max_plus_one(self):
        tmp, _ = self.make_flutter("2.5.0+40")
        r = run(["increment-code"], tmp)
        self.assertEqual(r.stdout.strip().splitlines()[-1], "41")


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


class TestSyncFailuresAreReported(SyncTestCase):
    def test_missing_version_key_is_added_on_increment(self):
        tmp = self.make_tmp("basic")
        yml = Path(tmp) / "version.yml"
        text = yml.read_text(encoding="utf-8")
        yml.write_text(re.sub(r"^version: .*\n", "", text, flags=re.M), encoding="utf-8")
        r = run(["increment"], tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.strip().splitlines()[-1], "0.0.1")
        self.assertIn('version: "0.0.1"', yml.read_text(encoding="utf-8"))
        r = run(["increment"], tmp)
        self.assertEqual(r.stdout.strip().splitlines()[-1], "0.0.2")

    def test_invalid_package_json_fails_with_nonzero_exit(self):
        tmp = self.make_tmp("react")
        (Path(tmp) / "package.json").write_text('{ "name": "my-app", "version": "0.5.0", }', encoding="utf-8")
        r = run(["increment"], tmp)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("ERROR", r.stderr)

    def test_single_quoted_pyproject_version_is_updated(self):
        tmp = self.make_tmp("python-proj")
        (Path(tmp) / "pyproject.toml").write_text("[project]\nname = 'my-app'\nversion = '0.9.10'\n",
                                                  encoding="utf-8")
        run(["set", "0.9.10"], tmp)
        r = run(["increment"], tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("version = '0.9.11'", (Path(tmp) / "pyproject.toml").read_text(encoding="utf-8"))

    def test_pyproject_tool_section_version_is_not_the_package_version(self):
        tmp = self.make_tmp("python-proj")
        toml = '[project]\nname = "my-app"\ndynamic = ["version"]\n\n[tool.other]\nversion = "9.9.9"\n'
        (Path(tmp) / "pyproject.toml").write_text(toml, encoding="utf-8")
        run(["set", "0.1.0"], tmp)
        r = run(["get"], tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(r.stdout.strip().splitlines()[-1], "0.1.0")
        self.assertNotIn("updated:", r.stderr)
        self.assertEqual((Path(tmp) / "pyproject.toml").read_text(encoding="utf-8"), toml)


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


    def test_sync_reads_project_paths_with_inline_comments(self):
        # The wizard renders comments after the key and each value line.
        tmp = self.make_tmp("monorepo")
        vy = Path(tmp) / "version.yml"
        text = vy.read_text(encoding="utf-8").replace(
            'project_paths:\n  flutter: "app"\n  react: "client"\n',
            'project_paths: # per-type project folder\n'
            '  flutter: "app" # app/pubspec.yaml\n'
            '  react: "client" # client/package.json\n',
        )
        self.assertIn("# app/pubspec.yaml", text)
        vy.write_text(text, encoding="utf-8")
        subprocess.run([sys.executable, str(SCRIPT), "set", "1.2.3"], cwd=tmp,
                       capture_output=True, text=True, encoding="utf-8")
        r = subprocess.run([sys.executable, str(SCRIPT), "sync"], cwd=tmp,
                           capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(r.returncode, 0)
        self.assertNotIn("not found", r.stdout + r.stderr)
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
