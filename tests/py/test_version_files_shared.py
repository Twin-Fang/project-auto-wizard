"""릴리스 시 버전 읽기(version_manager.py)가 공용 버전 파일 예시를 기대값대로 읽는지 확인한다.

같은 예시·기대값(tests/fixtures/version-files/expected.json)을 Node 테스트
(tests/node/version-files-shared.test.js)도 사용해, 설치 시 감지와 릴리스 시 읽기가
어긋나면 한쪽에서 드러난다.
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

# 파일에서 버전을 못 찾으면 version.yml 값으로 폴백하므로, 버전 형식이 아닌 표식을 둬 구분한다.
FALLBACK = "not-from-project-file"


def expected_for(case, lang):
    merged = dict(case)
    merged.update((case.get("knownDifference") or {}).get(lang) or {})
    return merged


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
        # version_manager는 현재 폴더의 version.yml을 기준으로 동작한다.
        cwd = os.getcwd()
        os.chdir(tmp)
        try:
            with contextlib.redirect_stderr(io.StringIO()):
                version = version_manager.get_project_file_version(case["type"])
                build_number = version_manager._pubspec_build_number(".")
        finally:
            os.chdir(cwd)

        want = expected_for(case, "python")
        self.assertEqual(None if version == FALLBACK else version, want["version"])
        # Python은 빌드 번호를 pubspec.yaml에서만 읽는다.
        if case["type"] == "flutter":
            self.assertEqual(build_number, want["buildNumber"])


if __name__ == "__main__":
    unittest.main()
