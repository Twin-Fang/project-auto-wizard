import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

_SCRIPT_DIR = Path(__file__).resolve().parents[2] / "payload" / "scripts"
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

import messages  # noqa: E402

SCRIPT = _SCRIPT_DIR / "messages.py"
HANGUL = re.compile(r"[가-힣]")
PLACEHOLDER = re.compile(r"\{(\w+)\}")


def _run(*args, cwd=None, env=None):
    full_env = {k: v for k, v in os.environ.items() if k != messages.LANG_ENV}
    full_env.update(env or {})
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args], cwd=cwd, env=full_env,
        capture_output=True, text=True, encoding="utf-8",
    )


class TestCatalog(unittest.TestCase):
    def test_en_and_ko_have_the_same_keys(self):
        self.assertEqual(set(messages.EN), set(messages.KO))

    def test_placeholders_match_between_languages(self):
        for key, en in messages.EN.items():
            self.assertEqual(
                sorted(PLACEHOLDER.findall(en)), sorted(PLACEHOLDER.findall(messages.KO[key])), key,
            )

    def test_english_catalog_has_no_hangul(self):
        for key, en in messages.EN.items():
            self.assertIsNone(HANGUL.search(en), key)

    def test_korean_catalog_is_actually_korean_where_english_has_words(self):
        # A ko value identical to en (and containing letters) usually means an untranslated copy
        untranslated = [
            k for k, v in messages.KO.items()
            if v == messages.EN[k] and re.search(r"[A-Za-z]{4,}", PLACEHOLDER.sub("", v)) and not HANGUL.search(v)
        ]
        # Pure-technical strings may legitimately match; keep the allowance tiny
        self.assertLessEqual(len(untranslated), 5, untranslated)


class TestLanguageResolution(unittest.TestCase):
    def _in_dir(self, version_yml=None):
        d = tempfile.TemporaryDirectory()
        self.addCleanup(d.cleanup)
        if version_yml is not None:
            Path(d.name, "version.yml").write_text(version_yml, encoding="utf-8")
        return Path(d.name)

    def test_default_is_english_without_version_yml(self):
        d = self._in_dir()
        self.assertEqual(_run("lang", cwd=d).stdout.strip(), "en")

    def test_reads_language_from_version_yml(self):
        d = self._in_dir('version: "1.0.0"\nlanguage: "ko" # message language: en | ko\n')
        self.assertEqual(_run("lang", cwd=d).stdout.strip(), "ko")

    def test_unquoted_and_uppercase_values_are_accepted(self):
        d = self._in_dir("language: KO\n")
        self.assertEqual(_run("lang", cwd=d).stdout.strip(), "ko")

    def test_unsupported_saved_value_falls_back_to_english(self):
        d = self._in_dir('language: "fr"\n')
        self.assertEqual(_run("lang", cwd=d).stdout.strip(), "en")

    def test_env_overrides_version_yml(self):
        d = self._in_dir('language: "en"\n')
        self.assertEqual(_run("lang", cwd=d, env={messages.LANG_ENV: "ko"}).stdout.strip(), "ko")

    def test_unsupported_env_value_is_ignored(self):
        d = self._in_dir('language: "ko"\n')
        self.assertEqual(_run("lang", cwd=d, env={messages.LANG_ENV: "xx"}).stdout.strip(), "ko")

    def test_language_key_must_be_a_top_level_line(self):
        d = self._in_dir('metadata:\n  language: "ko"\n')
        self.assertEqual(_run("lang", cwd=d).stdout.strip(), "en")


class TestLookup(unittest.TestCase):
    def setUp(self):
        catalog = {"en": {"x.a": "Hello {name}", "x.only_en": "English only", "x.json": "{\"k\": {v}}"},
                   "ko": {"x.a": "안녕 {name}"}}
        p = patch.dict(messages.CATALOG, catalog, clear=True)
        p.start()
        self.addCleanup(p.stop)

    def test_placeholders_are_replaced(self):
        self.assertEqual(messages.t("x.a", "en", name="A"), "Hello A")
        self.assertEqual(messages.t("x.a", "ko", name="A"), "안녕 A")

    def test_unknown_placeholder_and_other_braces_are_left_alone(self):
        self.assertEqual(messages.t("x.a", "en"), "Hello {name}")
        self.assertEqual(messages.t("x.json", "en", v=1), '{"k": 1}')

    def test_missing_ko_key_falls_back_to_english(self):
        self.assertEqual(messages.t("x.only_en", "ko"), "English only")

    def test_missing_key_returns_the_key(self):
        self.assertEqual(messages.t("x.nope", "ko"), "x.nope")

    def test_dump_filters_by_prefix_and_fills_english(self):
        self.assertEqual(messages.dump("x.", "ko")["x.only_en"], "English only")
        self.assertEqual(messages.dump("y.", "ko"), {})


class TestCli(unittest.TestCase):
    def test_get_and_dump_follow_the_language(self):
        key = next(iter(messages.EN))
        prefix = key.split(".")[0] + "."
        ko = _run("get", key, env={messages.LANG_ENV: "ko"})
        en = _run("get", key, env={messages.LANG_ENV: "en"})
        self.assertEqual(ko.returncode, 0)
        self.assertEqual(ko.stdout.rstrip("\n"), messages.template(key, "ko"))
        self.assertEqual(en.stdout.rstrip("\n"), messages.template(key, "en"))
        dumped = json.loads(_run("dump", prefix, env={messages.LANG_ENV: "ko"}).stdout)
        self.assertEqual(dumped[key], messages.template(key, "ko"))

    def test_get_fills_name_value_arguments(self):
        key = next((k for k, v in messages.EN.items() if PLACEHOLDER.search(v)), None)
        if key is None:
            self.skipTest("no placeholder keys yet")
        name = PLACEHOLDER.search(messages.EN[key]).group(1)
        out = _run("get", key, f"{name}=VALUE", env={messages.LANG_ENV: "en"}).stdout
        self.assertIn("VALUE", out)

    def test_usage_error_exit_code(self):
        self.assertEqual(_run("bogus").returncode, 2)


if __name__ == "__main__":
    unittest.main()
