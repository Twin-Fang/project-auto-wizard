import os
import subprocess
import sys
import shutil
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "payload" / "scripts" / "truncate_release_notes.py"


def run(args, env=None):
    full_env = {**os.environ, **(env or {})}
    return subprocess.run([sys.executable, str(SCRIPT), *args],
                           capture_output=True, text=True, env=full_env)


class TestTruncateReleaseNotes(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="truncate_")
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.path = Path(self.tmp) / "final_release_notes.txt"

    def write(self, text, encoding="utf-8"):
        self.path.write_bytes(text.encode(encoding) if isinstance(text, str) else text)

    def test_char_mode_truncates_over_limit(self):
        self.write("가" * 20)
        r = run([str(self.path), "10", "char"])
        self.assertEqual(r.returncode, 0)
        text = self.path.read_text(encoding="utf-8")
        self.assertEqual(text, "가" * 10)

    def test_char_mode_leaves_under_limit_untouched(self):
        self.write("hello")
        r = run([str(self.path), "480", "char"])
        self.assertEqual(r.returncode, 0)
        self.assertEqual(self.path.read_text(encoding="utf-8"), "hello")

    def test_byte_mode_truncates_without_splitting_multibyte(self):
        # "가"는 UTF-8로 3바이트 — limit=16(3의 배수가 아님)으로 잘라도
        # 결과는 항상 완전한 문자로만 구성되고 유효한 UTF-8이어야 한다.
        self.write("가" * 10)  # 30바이트
        r = run([str(self.path), "16", "byte"])
        self.assertEqual(r.returncode, 0)
        data = self.path.read_bytes()
        self.assertLessEqual(len(data), 16)
        decoded = data.decode("utf-8")  # 깨진 바이트가 남아있으면 여기서 예외 발생
        self.assertNotIn("�", decoded)
        self.assertEqual(decoded, "가" * 5)  # 15바이트 = 완전한 5글자, 16번째 바이트부터는 버려짐

    def test_byte_mode_leaves_under_limit_untouched(self):
        self.write("hello")
        r = run([str(self.path), "4000", "byte"])
        self.assertEqual(r.returncode, 0)
        self.assertEqual(self.path.read_text(encoding="utf-8"), "hello")

    def test_missing_file_is_noop_exit_0(self):
        missing = Path(self.tmp) / "does_not_exist.txt"
        r = run([str(missing), "480", "char"])
        self.assertEqual(r.returncode, 0)
        self.assertFalse(missing.exists())

    def test_lf_preserved(self):
        self.write("line1\nline2\n" * 50)  # 넉넉히 길게 만들어 truncate 유도
        run([str(self.path), "20", "char"])
        data = self.path.read_bytes()
        self.assertNotIn(b"\r\n", data)

    def test_crlf_preserved(self):
        self.write(("line1\r\nline2\r\n" * 50))
        run([str(self.path), "20", "char"])
        data = self.path.read_bytes()
        self.assertGreater(data.count(b"\r\n"), 0)
        self.assertEqual(data.count(b"\n"), data.count(b"\r\n"))

    def test_limit_zero_rejected(self):
        self.write("hello")
        r = run([str(self.path), "0", "char"])
        self.assertEqual(r.returncode, 1)
        self.assertEqual(self.path.read_text(encoding="utf-8"), "hello")

    def test_limit_negative_rejected(self):
        self.write("hello")
        r = run([str(self.path), "-5", "char"])
        self.assertEqual(r.returncode, 1)
        self.assertEqual(self.path.read_text(encoding="utf-8"), "hello")

    def test_non_utf8_input_does_not_crash(self):
        self.write(b"\xff\xfe\x00broken")
        r = run([str(self.path), "3", "char"])
        self.assertEqual(r.returncode, 0)

    def test_idempotent_on_rerun(self):
        self.write("가" * 20)
        run([str(self.path), "10", "char"])
        first = self.path.read_text(encoding="utf-8")
        r = run([str(self.path), "10", "char"])
        self.assertEqual(r.returncode, 0)
        self.assertEqual(self.path.read_text(encoding="utf-8"), first)

    def test_survives_non_utf8_console_encoding(self):
        self.write("가" * 20)
        r = run([str(self.path), "10", "char"], env={"PYTHONIOENCODING": "ascii"})
        self.assertEqual(r.returncode, 0)


if __name__ == "__main__":
    unittest.main()
