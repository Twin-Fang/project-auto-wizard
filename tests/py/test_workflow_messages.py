import re
import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
_SCRIPT_DIR = _ROOT / "payload" / "scripts"
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

import messages  # noqa: E402

# `$(m some.key name="value" ...)` calls as written in the workflow shell snippets
CALL = re.compile(r'\$\(m ([a-z_0-9]+\.[a-z_0-9]+)((?:\s+\w+="[^"]*")*)\)')
ARG = re.compile(r'(\w+)="')
PLACEHOLDER = re.compile(r"\{(\w+)\}")


def _workflow_files():
    return sorted((_ROOT / "payload" / "workflows").rglob("*.y*ml"))


class TestWorkflowMessageCalls(unittest.TestCase):
    def test_every_key_used_by_a_workflow_exists_in_both_languages(self):
        seen = 0
        for path in _workflow_files():
            for key, _ in CALL.findall(path.read_text(encoding="utf-8")):
                seen += 1
                for lang in messages.SUPPORTED:
                    self.assertIn(key, messages.CATALOG[lang], f"{path.name}: {key} missing in {lang}")
        self.assertGreater(seen, 0)

    def test_every_placeholder_is_passed_by_the_call(self):
        for path in _workflow_files():
            for key, args in CALL.findall(path.read_text(encoding="utf-8")):
                passed = set(ARG.findall(args))
                for lang in messages.SUPPORTED:
                    needed = set(PLACEHOLDER.findall(messages.CATALOG[lang][key]))
                    self.assertTrue(needed <= passed, f"{path.name}: {key} ({lang}) needs {needed - passed}")

    def test_korean_output_has_no_unfilled_placeholder(self):
        for path in _workflow_files():
            for key, args in CALL.findall(path.read_text(encoding="utf-8")):
                params = {n: "X" for n in ARG.findall(args)}
                text = messages.t(key, lang="ko", **params)
                self.assertEqual(PLACEHOLDER.findall(text), [], f"{key}: {text}")


if __name__ == "__main__":
    unittest.main()
