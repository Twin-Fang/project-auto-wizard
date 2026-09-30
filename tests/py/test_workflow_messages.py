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
# Bare `m some.key name="value"` calls on their own line (or after && / ||); the rest of the line (lookahead, so several calls on one line are all seen) is scanned for names
BARE = re.compile(r'(?:^|[\s;&|])m ([a-z_0-9]+\.[a-z_0-9]+)((?:\s+\w+="[^"]*")*)(?=(.*)$)', re.M)
# Keys used without an area prefix inside the remote deploy scripts (the server-side m() prepends the area)
REMOTE_BARE = re.compile(r"^\s+m ([a-z_0-9]+)((?:\s+\w+=\"[^\"]*\")*)", re.M)
STEP_START = re.compile(r"^      - ", re.M)
JOB_START = re.compile(r"^  [A-Za-z0-9_-]+:\s*$", re.M)
M_DEF = re.compile(r"^\s*m\(\) \{", re.M)


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


def _all_calls(text):
    """(key, passed-arg-names) for every `$(m ...)` and bare `m ...` call in a workflow file."""
    for key, args in CALL.findall(text):
        yield key, set(ARG.findall(args))
    for key, args, rest in BARE.findall(text):
        yield key, set(ARG.findall(args)) | set(re.findall(r'(?<![\w$])(\w+)="', rest))


class TestBareCalls(unittest.TestCase):
    def test_bare_calls_use_existing_keys_and_pass_their_placeholders(self):
        seen = 0
        for path in _workflow_files():
            for key, passed in _all_calls(path.read_text(encoding="utf-8")):
                seen += 1
                for lang in messages.SUPPORTED:
                    self.assertIn(key, messages.CATALOG[lang], f"{path.name}: {key} missing in {lang}")
                    needed = set(PLACEHOLDER.findall(messages.CATALOG[lang][key]))
                    self.assertTrue(needed <= passed, f"{path.name}: {key} ({lang}) needs {needed - passed}")
        self.assertGreater(seen, 0)

    def test_remote_deploy_keys_exist_in_the_dumped_area(self):
        # The server-side m() reads M_wf_spring_deploy_<key>, so each short key must exist under that prefix
        deploy_dir = _ROOT / "payload" / "workflows" / "spring" / "server-deploy"
        for path in sorted(deploy_dir.glob("*.y*ml")):
            text = path.read_text(encoding="utf-8")
            if "M_wf_spring_deploy_" not in text:
                continue
            for key, args in REMOTE_BARE.findall(text):
                full = f"wf_spring_deploy.{key}"
                if full not in messages.CATALOG["en"]:
                    continue
                passed = set(ARG.findall(args))
                for lang in messages.SUPPORTED:
                    needed = set(PLACEHOLDER.findall(messages.CATALOG[lang][full]))
                    self.assertTrue(needed <= passed, f"{path.name}: {full} ({lang}) needs {needed - passed}")


class TestStepsCanReadMessages(unittest.TestCase):
    """A step that calls m must define it in the same step, after a checkout that brings messages.py."""

    def _jobs(self, text):
        body = text.split("\njobs:\n", 1)[-1] if "\njobs:\n" in text else ""
        heads = [mt.start() for mt in JOB_START.finditer(body)]
        heads.append(len(body))
        return [body[a:b] for a, b in zip(heads, heads[1:])]

    def test_every_m_user_defines_m_and_follows_a_checkout(self):
        checked = 0
        for path in _workflow_files():
            text = path.read_text(encoding="utf-8")
            for job in self._jobs(text):
                starts = [mt.start() for mt in STEP_START.finditer(job)] + [len(job)]
                seen_checkout = False
                for a, b in zip(starts, starts[1:]):
                    step = job[a:b]
                    if "actions/checkout" in step:
                        seen_checkout = True
                    # github-script steps use a JS m(); SSH deploy scripts get their own m() on the server
                    if "github-script" in step or "ssh-action" in step:
                        continue
                    if not (CALL.search(step) or BARE.search(step)):
                        continue
                    checked += 1
                    name = step.splitlines()[0].strip()
                    self.assertRegex(step, M_DEF, f"{path.name}: step '{name}' calls m without defining it")
                    self.assertTrue(seen_checkout, f"{path.name}: step '{name}' calls m before any checkout")
        self.assertGreater(checked, 0)


if __name__ == "__main__":
    unittest.main()
