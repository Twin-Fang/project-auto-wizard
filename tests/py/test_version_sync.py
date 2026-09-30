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
                          cwd=cwd, capture_output=True, text=True, encoding="utf-8")


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


class TestSyncSpringIndentedVersion(SyncTestCase):
    """An indented `version =` (plugin config block etc.) is not the project version."""

    def _gradle(self, body):
        tmp = self.make_tmp("spring")
        gradle = Path(tmp) / "build.gradle"
        gradle.write_text(body, encoding="utf-8")
        return tmp, gradle

    def test_plugin_block_version_is_not_the_project_version(self):
        tmp, gradle = self._gradle(
            "node {\n    version = '20.11.0'\n}\n\ngroup = 'com.example'\nversion = '1.7.2'\n")
        self.assertEqual(last_line(run(["get"], tmp)), "1.7.2")
        r = run(["increment"], tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        text = gradle.read_text(encoding="utf-8")
        self.assertIn("    version = '20.11.0'", text)
        self.assertIn("\nversion = '1.7.3'", text)

    def test_allprojects_block_version_is_the_project_version(self):
        tmp, gradle = self._gradle(
            "node {\n    version = '20.11.0'\n}\n\nallprojects {\n    version = '2.3.4'\n}\n")
        self.assertEqual(last_line(run(["get"], tmp)), "2.3.4")
        r = run(["increment"], tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        text = gradle.read_text(encoding="utf-8")
        self.assertIn("    version = '20.11.0'", text)
        self.assertIn("    version = '2.3.5'", text)

    def test_url_slashes_in_string_do_not_break_block_tracking(self):
        tmp, gradle = self._gradle(
            "allprojects {\n    repositories {\n        maven { url 'https://jitpack.io' }\n    }\n"
            "    version = '2.3.4'\n}\n\nnode {\n    version = '20.11.0'\n}\n")
        self.assertEqual(last_line(run(["get"], tmp)), "2.3.4")
        r = run(["increment"], tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        text = gradle.read_text(encoding="utf-8")
        self.assertIn("    version = '2.3.5'", text)
        self.assertIn("    version = '20.11.0'", text)

    def test_only_plugin_block_version_is_not_synced(self):
        tmp, gradle = self._gradle("node {\n    version = '20.11.0'\n}\n")
        run(["set", "1.2.3"], tmp)
        run(["sync"], tmp)
        self.assertIn("version = '20.11.0'", gradle.read_text(encoding="utf-8"))


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
        # The versions of the parent BOM, dependencies and comments stay as they are
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


class TestSyncJsonKeepsFormatting(SyncTestCase):
    # Only the one version line may change — rewriting indentation with a fixed value would make every release a whole-file diff.
    def _sync_with(self, text):
        tmp = self.make_tmp("react")
        pkg = Path(tmp) / "package.json"
        pkg.write_text(text, encoding="utf-8")
        run(["set", "1.2.3"], tmp)
        r = run(["sync"], tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        r = run(["get"], tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        return pkg.read_text(encoding="utf-8")

    def test_four_space_indent_is_preserved(self):
        before = '{\n    "name": "my-app",\n    "version": "0.5.0",\n    "scripts": {\n        "build": "vite build"\n    }\n}\n'
        self.assertEqual(self._sync_with(before), before.replace("0.5.0", "1.2.3"))

    def test_tab_indent_is_preserved(self):
        before = '{\n\t"name": "my-app",\n\t"version": "0.5.0"\n}\n'
        self.assertEqual(self._sync_with(before), before.replace("0.5.0", "1.2.3"))

    def test_two_space_indent_is_unchanged(self):
        before = '{\n  "name": "my-app",\n  "version": "0.5.0"\n}\n'
        self.assertEqual(self._sync_with(before), before.replace("0.5.0", "1.2.3"))


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

    def test_failed_type_is_named_in_the_summary_message(self):
        # The summary lists the failing types; it must not crash while joining them
        tmp = self.make_tmp("react")
        (Path(tmp) / "package.json").write_text('{ "name": "my-app", "version": "0.5.0", }', encoding="utf-8")
        r = run(["set", "1.0.1"], tmp)
        self.assertNotEqual(r.returncode, 0)
        self.assertNotIn("Traceback", r.stderr)
        self.assertIn("project file sync failed for: react", r.stderr)

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


class TestSyncReactNativePlistScope(SyncTestCase):
    def _plist(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            "<plist><dict><key>CFBundleShortVersionString</key>"
            f"<string>{value}</string></dict></plist>\n", encoding="utf-8")

    def test_pods_and_build_variable_plists_are_left_alone(self):
        tmp = self.make_tmp("react-native")
        ios = Path(tmp) / "ios"
        pods = ios / "Pods" / "Info.plist"
        self._plist(pods, "9.9.9")
        self._plist(ios / "Pods" / "SomeLib" / "Info.plist", "3.0.0")
        var = ios / "MyAppTests" / "Info.plist"
        self._plist(var, "$(MARKETING_VERSION)")
        run(["set", "1.2.3"], tmp)
        r = run(["sync"], tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("<string>9.9.9</string>", pods.read_text(encoding="utf-8"))
        self.assertIn("<string>3.0.0</string>", (ios / "Pods" / "SomeLib" / "Info.plist").read_text(encoding="utf-8"))
        self.assertIn("$(MARKETING_VERSION)", var.read_text(encoding="utf-8"))
        self.assertIn("<string>1.2.3</string>", (ios / "App" / "Info.plist").read_text(encoding="utf-8"))

    def test_app_plist_with_build_variable_is_not_overwritten(self):
        tmp = self.make_tmp("react-native")
        plist = Path(tmp) / "ios" / "App" / "Info.plist"
        self._plist(plist, "$(MARKETING_VERSION)")
        run(["set", "1.2.3"], tmp)
        r = run(["sync"], tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("$(MARKETING_VERSION)", plist.read_text(encoding="utf-8"))
        gradle = (Path(tmp) / "android" / "app" / "build.gradle").read_text(encoding="utf-8")
        self.assertIn('versionName "1.2.3"', gradle)


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



def last_line(r):
    return r.stdout.strip().splitlines()[-1]


class TestVersionSuffixesAndSources(SyncTestCase):
    """Read with the same rules as install-time detection and check the file is still valid after the bump."""

    def test_gradle_snapshot_is_read_as_core_and_kept_on_increment(self):
        tmp = self.make_tmp("spring")
        gradle = Path(tmp) / "build.gradle"
        gradle.write_text("group = 'com.example'\nversion = '1.2.0-SNAPSHOT'\n", encoding="utf-8")
        self.assertEqual(last_line(run(["get"], tmp)), "1.2.0")
        r = run(["increment"], tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(last_line(r), "1.2.1")
        self.assertIn("version = '1.2.1-SNAPSHOT'", gradle.read_text(encoding="utf-8"))
        self.assertIn('version: "1.2.1"', (Path(tmp) / "version.yml").read_text(encoding="utf-8"))

    def test_pom_snapshot_is_kept_on_increment(self):
        tmp = self.make_tmp("spring")
        (Path(tmp) / "build.gradle").unlink()
        pom = Path(tmp) / "pom.xml"
        pom.write_text("<project>\n  <artifactId>my-service</artifactId>\n"
                       "  <version>0.0.1-SNAPSHOT</version>\n</project>\n", encoding="utf-8")
        r = run(["increment"], tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(last_line(r), "0.0.2")
        self.assertIn("<version>0.0.2-SNAPSHOT</version>", pom.read_text(encoding="utf-8"))

    def test_gradle_without_version_falls_through_to_kts(self):
        tmp = self.make_tmp("spring")
        (Path(tmp) / "build.gradle").write_text("allprojects {\n    repositories { mavenCentral() }\n}\n",
                                                encoding="utf-8")
        kts = Path(tmp) / "build.gradle.kts"
        kts.write_text('version = "4.5.6"\n', encoding="utf-8")
        self.assertEqual(last_line(run(["get"], tmp)), "4.5.6")
        run(["increment"], tmp)
        self.assertIn('version = "4.5.7"', kts.read_text(encoding="utf-8"))

    def test_flutter_prerelease_is_read_as_core_with_build_number(self):
        tmp = self.make_tmp("flutter")
        pubspec = Path(tmp) / "pubspec.yaml"
        text = pubspec.read_text(encoding="utf-8")
        pubspec.write_text(re.sub(r"^version: .*$", "version: 1.2.3-rc.1+4", text, flags=re.M), encoding="utf-8")
        self.assertEqual(last_line(run(["get"], tmp)), "1.2.3")
        self.assertEqual(last_line(run(["get-code"], tmp)), "4")
        r = run(["increment"], tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        # A pre-release marker belongs to that version only, so it is not carried onto the new version.
        self.assertIn("version: 1.2.4+5", pubspec.read_text(encoding="utf-8"))

    def test_package_json_prerelease_is_read_as_core(self):
        tmp = self.make_tmp("react")
        pkg = Path(tmp) / "package.json"
        data = json.loads(pkg.read_text(encoding="utf-8"))
        data["version"] = "2.0.0-beta.1"
        pkg.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        self.assertEqual(last_line(run(["get"], tmp)), "2.0.0")
        r = run(["increment"], tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(pkg.read_text(encoding="utf-8"))["version"], "2.0.1")

    def test_react_native_skips_non_semver_native_values(self):
        tmp = self.make_tmp("react-native")
        run(["set", "0.3.0"], tmp)
        plist = Path(tmp) / "ios" / "App" / "Info.plist"
        plist.write_text(re.sub(r"(<key>CFBundleShortVersionString</key>\s*<string>)[^<]*",
                                r"\g<1>$(MARKETING_VERSION)", plist.read_text(encoding="utf-8")),
                         encoding="utf-8")
        gradle = Path(tmp) / "android" / "app" / "build.gradle"
        gradle.write_text(re.sub(r'versionName\s+"[^"]*"', 'versionName "1.0"', gradle.read_text(encoding="utf-8")),
                          encoding="utf-8")
        # If the native file has no x.y.z, the version.yml value is used (at install time the package.json value is put there).
        self.assertEqual(last_line(run(["get"], tmp)), "0.3.0")
        self.assertIn('versionName "0.3.0"', gradle.read_text(encoding="utf-8"))

    def test_setup_py_version_is_read_and_updated(self):
        tmp = self.make_tmp("python-proj")
        (Path(tmp) / "pyproject.toml").unlink()
        setup_py = Path(tmp) / "setup.py"
        setup_py.write_text('from setuptools import setup\n\n'
                            'setup(name="my-service", version="0.2.0", python_requires=">=3.9")\n',
                            encoding="utf-8")
        self.assertEqual(last_line(run(["get"], tmp)), "0.2.0")
        r = run(["increment"], tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        text = setup_py.read_text(encoding="utf-8")
        self.assertIn('version="0.2.1"', text)
        self.assertIn('python_requires=">=3.9"', text)


if __name__ == "__main__":
    unittest.main()


class TestGetReconcilesFilesToCore(SyncTestCase):
    """Even though get looks read-only, the sync step realigns the file to the core x.y.z."""

    def test_get_rewrites_package_json_prerelease_to_core(self):
        tmp = self.make_tmp("react")
        pkg = Path(tmp) / "package.json"
        data = json.loads(pkg.read_text(encoding="utf-8"))
        data["version"] = "2.0.0-beta.1"
        pkg.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        # If version.yml already has the same core version, the sync step rewrites the file to the core.
        run(["set", "2.0.0"], tmp)
        pkg.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
        self.assertEqual(last_line(run(["get"], tmp)), "2.0.0")
        self.assertEqual(json.loads(pkg.read_text(encoding="utf-8"))["version"], "2.0.0")

    def test_get_rewrites_pubspec_prerelease_keeping_build_number(self):
        tmp = self.make_tmp("flutter")
        pubspec = Path(tmp) / "pubspec.yaml"
        run(["set", "1.2.3"], tmp)
        pubspec.write_text("name: my_app\nversion: 1.2.3-rc.1+4\n", encoding="utf-8")
        self.assertEqual(last_line(run(["get"], tmp)), "1.2.3")
        self.assertIn("version: 1.2.3+4", pubspec.read_text(encoding="utf-8"))

    def test_pyproject_and_setup_py_are_both_updated(self):
        tmp = self.make_tmp("python-proj")
        (Path(tmp) / "pyproject.toml").write_text('[project]\nname = "my-app"\nversion = "0.9.0"\n', encoding="utf-8")
        (Path(tmp) / "setup.py").write_text('from setuptools import setup\nsetup(name="my-app", version="0.9.0")\n', encoding="utf-8")
        r = run(["increment"], tmp)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('version = "0.9.1"', (Path(tmp) / "pyproject.toml").read_text(encoding="utf-8"))
        self.assertIn('version="0.9.1"', (Path(tmp) / "setup.py").read_text(encoding="utf-8"))
