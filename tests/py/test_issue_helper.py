import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parents[2] / "payload" / "scripts"
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

import issue_helper  # noqa: E402

SCRIPT = Path(__file__).resolve().parents[2] / "payload" / "scripts" / "issue_helper.py"


class TestExtractIssueNumber(unittest.TestCase):
    def test_extracts_trailing_number(self):
        self.assertEqual(issue_helper.extract_issue_number("https://github.com/o/r/issues/68"), "68")

    def test_strips_trailing_slash(self):
        self.assertEqual(issue_helper.extract_issue_number("https://github.com/o/r/issues/68/"), "68")


class TestExtractIssueNumberFromBranch(unittest.TestCase):
    def test_extracts_from_standard_branch_name(self):
        self.assertEqual(
            issue_helper.extract_issue_number_from_branch("20260824_#102_feat_추가"),
            "102",
        )

    def test_extracts_from_worktree_issue_branch_name(self):
        self.assertEqual(
            issue_helper.extract_issue_number_from_branch("worktree-issue-93-branch-strategy"),
            "93",
        )

    def test_no_issue_number_returns_none(self):
        self.assertIsNone(
            issue_helper.extract_issue_number_from_branch("cleanup-docs-typo")
        )

    def test_multiple_hashes_uses_first_match(self):
        self.assertEqual(
            issue_helper.extract_issue_number_from_branch("20260824_#102_feat_#extra"),
            "102",
        )

    def test_multi_digit_issue_number(self):
        self.assertEqual(
            issue_helper.extract_issue_number_from_branch("20260101_#12345_x"),
            "12345",
        )

    def test_hash_takes_priority_over_word_pattern(self):
        self.assertEqual(
            issue_helper.extract_issue_number_from_branch("issue/20260827_#121_foo"),
            "121",
        )

    def test_word_pattern_case_insensitive(self):
        self.assertEqual(
            issue_helper.extract_issue_number_from_branch("WORKTREE-ISSUE-42-x"),
            "42",
        )


class TestExtractIssueTitle(unittest.TestCase):
    def test_strips_leading_tag(self):
        self.assertEqual(issue_helper.extract_issue_title("[개선] 제목입니다"), "제목입니다")

    def test_strips_emoji(self):
        self.assertEqual(issue_helper.extract_issue_title("버그 발견 🐛🔥"), "버그 발견")

    def test_strips_variation_selector_and_zwj(self):
        # Emoji sequence joined by ZWJ (U+200D) + variation selector (U+FE0F)
        raw = "가족\U0001F468‍\U0001F469‍\U0001F467 이슈️"
        self.assertEqual(issue_helper.extract_issue_title(raw), "가족 이슈")

    def test_strips_control_characters(self):
        self.assertEqual(issue_helper.extract_issue_title("제목\x00\x01끝"), "제목끝")

    def test_falls_back_to_original_when_result_is_empty(self):
        self.assertEqual(issue_helper.extract_issue_title("🐛🔥"), "🐛🔥")

    def test_no_tag_no_emoji_unchanged(self):
        self.assertEqual(issue_helper.extract_issue_title("평범한 제목"), "평범한 제목")


class TestNormalizeTitle(unittest.TestCase):
    def test_keeps_korean_english_digits(self):
        self.assertEqual(issue_helper.normalize_title("한글abc123"), "한글abc123")

    def test_replaces_special_chars_with_underscore(self):
        self.assertEqual(issue_helper.normalize_title("a-b c!d"), "a_b_c_d")

    def test_collapses_consecutive_underscores(self):
        self.assertEqual(issue_helper.normalize_title("a---b"), "a_b")

    def test_trims_leading_trailing_underscores(self):
        self.assertEqual(issue_helper.normalize_title("!!!제목!!!"), "제목")


class TestCreateBranchName(unittest.TestCase):
    def test_basic_format(self):
        name = issue_helper.create_branch_name("버그 수정", "68", "20260810", "", 100)
        self.assertEqual(name, "20260810_#68_버그_수정")

    def test_applies_prefix(self):
        name = issue_helper.create_branch_name("버그 수정", "68", "20260810", "feat/", 100)
        self.assertEqual(name, "feat/20260810_#68_버그_수정")

    def test_truncates_base_excluding_prefix(self):
        long_title = "가" * 50
        name = issue_helper.create_branch_name(long_title, "68", "20260810", "feat/", 20)
        base = name[len("feat/"):]
        self.assertEqual(len(base), 20)
        self.assertTrue(name.startswith("feat/20260810_#68_"))

    def test_zero_max_length_means_no_truncation(self):
        long_title = "가" * 50
        name = issue_helper.create_branch_name(long_title, "68", "20260810", "", 0)
        self.assertEqual(name, f"20260810_#68_{long_title}")


class TestRenderCommitMessage(unittest.TestCase):
    def test_substitutes_all_variables(self):
        msg = issue_helper.render_commit_message(
            "${issueTitle} / ${issueUrl} / ${issueNumber} / ${branchName} / ${date}",
            "정규화된_제목", "https://github.com/o/r/issues/68", "68",
            "20260810_#68_정규화된_제목", "20260810",
        )
        self.assertEqual(
            msg,
            "정규화된_제목 / https://github.com/o/r/issues/68 / 68 / 20260810_#68_정규화된_제목 / 20260810",
        )

    def test_strips_result(self):
        msg = issue_helper.render_commit_message("  ${issueTitle}  ", "제목", "u", "1", "b", "d")
        self.assertEqual(msg, "제목")

    def test_literal_braces_untouched(self):
        msg = issue_helper.render_commit_message(
            "${issueTitle} : feat : {변경 사항에 대한 설명} ${issueUrl}",
            "제목", "https://github.com/o/r/issues/68", "68", "b", "d",
        )
        self.assertEqual(msg, "제목 : feat : {변경 사항에 대한 설명} https://github.com/o/r/issues/68")


class TestNormalizeAll(unittest.TestCase):
    def test_end_to_end(self):
        branch_name, commit_message = issue_helper.normalize_all(
            "버그 발견", "https://github.com/o/r/issues/68", "68", "20260810", "", 100,
            "${issueTitle} : feat : {설명} ${issueUrl}",
        )
        self.assertEqual(branch_name, "20260810_#68_버그_발견")
        self.assertEqual(
            commit_message,
            "버그_발견 : feat : {설명} https://github.com/o/r/issues/68",
        )


class TestNonKoreanEnglishTitles(unittest.TestCase):
    def normalize(self, title):
        return issue_helper.normalize_all(
            issue_helper.extract_issue_title(title), "https://github.com/o/r/issues/12", "12",
            "20260925", "", 100, "${issueTitle} : feat : {설명} ${issueUrl}",
        )

    def test_japanese_title_is_kept(self):
        branch, commit = self.normalize("日本語のタイトル")
        self.assertEqual(branch, "20260925_#12_日本語のタイトル")
        self.assertTrue(commit.startswith("日本語のタイトル : feat : "))

    def test_accented_letters_are_kept(self):
        branch, _ = self.normalize("Café menu")
        self.assertEqual(branch, "20260925_#12_Café_menu")

    def test_emoji_or_blank_title_uses_fallback_name(self):
        for title in ("🎉🎉🎉", "   ", "!!!"):
            branch, commit = self.normalize(title)
            self.assertEqual(branch, "20260925_#12_issue", title)
            self.assertTrue(commit.startswith("issue : feat : "), title)

    def test_truncation_does_not_end_with_separator(self):
        name = issue_helper.create_branch_name("ab cd", "12", "20260925", "", len("20260925_#12_ab_"))
        self.assertEqual(name, "20260925_#12_ab")


class TestUpsertIssueLinksInBody(unittest.TestCase):
    def test_empty_issue_numbers_returns_unchanged(self):
        body, changed = issue_helper.upsert_issue_links_in_body("기존 본문", [], False)
        self.assertEqual(body, "기존 본문")
        self.assertFalse(changed)

    def test_appends_block_when_no_marker(self):
        body, changed = issue_helper.upsert_issue_links_in_body("기존 본문", ["102"], False)
        self.assertTrue(changed)
        self.assertEqual(
            body,
            "기존 본문\n\n<!-- auto-issue-link:start -->\nCloses #102\n<!-- auto-issue-link:end -->",
        )

    def test_appends_without_leading_blank_lines_when_body_empty(self):
        body, changed = issue_helper.upsert_issue_links_in_body("", ["102"], False)
        self.assertTrue(changed)
        self.assertEqual(
            body,
            "<!-- auto-issue-link:start -->\nCloses #102\n<!-- auto-issue-link:end -->",
        )

    def test_skips_when_marker_exists_and_not_replacing(self):
        existing = "설명\n\n<!-- auto-issue-link:start -->\nCloses #1\n<!-- auto-issue-link:end -->"
        body, changed = issue_helper.upsert_issue_links_in_body(existing, ["2"], False)
        self.assertEqual(body, existing)
        self.assertFalse(changed)

    def test_replaces_block_when_marker_exists_and_replacing(self):
        existing = "설명\n\n<!-- auto-issue-link:start -->\nCloses #1\n<!-- auto-issue-link:end -->\n\n뒷부분"
        body, changed = issue_helper.upsert_issue_links_in_body(existing, ["2", "3"], True)
        self.assertTrue(changed)
        self.assertEqual(
            body,
            "설명\n\n<!-- auto-issue-link:start -->\nCloses #2\nCloses #3\n<!-- auto-issue-link:end -->\n\n뒷부분",
        )

    def test_appends_new_block_when_start_marker_present_without_end(self):
        # A damaged state with START but no END (manual edit, earlier failed run, ...) —
        # to keep the regex from matching nothing and the update being silently voided,
        # anything that is not a complete block counts as "no marker" and a new block is appended.
        body = "설명\n\n<!-- auto-issue-link:start -->\n망가진 상태"
        new_body, changed = issue_helper.upsert_issue_links_in_body(body, ["9"], True)
        self.assertTrue(changed)
        self.assertTrue(new_body.startswith(body))
        self.assertIn(
            "<!-- auto-issue-link:start -->\nCloses #9\n<!-- auto-issue-link:end -->",
            new_body,
        )


class TestBuildIssueLinksBlock(unittest.TestCase):
    def test_single_issue(self):
        self.assertEqual(
            issue_helper.build_issue_links_block(["102"]),
            "<!-- auto-issue-link:start -->\nCloses #102\n<!-- auto-issue-link:end -->",
        )

    def test_multiple_issues(self):
        self.assertEqual(
            issue_helper.build_issue_links_block(["1", "2"]),
            "<!-- auto-issue-link:start -->\nCloses #1\nCloses #2\n<!-- auto-issue-link:end -->",
        )


def run_cli(event_payload, env_extra=None):
    with tempfile.TemporaryDirectory() as tmp:
        event_path = Path(tmp) / "event.json"
        event_path.write_text(json.dumps(event_payload), encoding="utf-8")
        env = {
            **os.environ,
            "PYTHONIOENCODING": "utf-8",
            "GITHUB_EVENT_PATH": str(event_path),
            "GITHUB_REPOSITORY": "o/r",
        }
        if env_extra:
            env.update(env_extra)
        return subprocess.run(
            [sys.executable, str(SCRIPT), "run"],
            capture_output=True, text=True, encoding="utf-8", env=env,
        )


class TestRunGuards(unittest.TestCase):
    def test_missing_event_path_exits_1(self):
        env = {k: v for k, v in os.environ.items() if k != "GITHUB_EVENT_PATH"}
        env["GITHUB_REPOSITORY"] = "o/r"
        r = subprocess.run([sys.executable, str(SCRIPT), "run"], capture_output=True, text=True, encoding="utf-8", env=env)
        self.assertEqual(r.returncode, 1)

    def test_irrelevant_action_exits_0_without_token(self):
        r = run_cli({"action": "closed", "issue": {"number": 1, "title": "t", "html_url": "u"}})
        self.assertEqual(r.returncode, 0)

    def test_edited_without_title_change_exits_0(self):
        r = run_cli({
            "action": "edited",
            "issue": {"number": 1, "title": "t", "html_url": "u"},
            "changes": {"body": {"from": "old"}},
        })
        self.assertEqual(r.returncode, 0)

    def test_opened_without_token_exits_1(self):
        # env_extra passes only the delta — spreading all of os.environ would let the real
        # GITHUB_EVENT_PATH of a CI runner (GitHub Actions) override run_cli's temp event
        # path, so the runner's own trigger event (action is not 'opened') gets read and the test turns flaky.
        r = run_cli(
            {"action": "opened", "issue": {"number": 1, "title": "t", "html_url": "u"}},
            env_extra={"GITHUB_TOKEN": ""},
        )
        self.assertEqual(r.returncode, 1)

    def test_malformed_repository_env_exits_1(self):
        r = run_cli(
            {"action": "opened", "issue": {"number": 1, "title": "t", "html_url": "u"}},
            env_extra={"GITHUB_REPOSITORY": "not-a-repo-slug", "GITHUB_TOKEN": "x"},
        )
        self.assertEqual(r.returncode, 1)


class TestExtractBranchIssueCli(unittest.TestCase):
    def test_prints_issue_number(self):
        r = subprocess.run(
            [sys.executable, str(SCRIPT), "extract-branch-issue", "20260824_#102_feat_추가"],
            capture_output=True, text=True, encoding="utf-8",
        )
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "102")

    def test_matches_worktree_issue_branch_name(self):
        r = subprocess.run(
            [sys.executable, str(SCRIPT), "extract-branch-issue", "worktree-issue-93-branch-strategy"],
            capture_output=True, text=True, encoding="utf-8",
        )
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "93")

    def test_no_match_prints_nothing(self):
        r = subprocess.run(
            [sys.executable, str(SCRIPT), "extract-branch-issue", "cleanup-docs-typo"],
            capture_output=True, text=True, encoding="utf-8",
        )
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "")


class TestLinkPrIssuesCliGuards(unittest.TestCase):
    def test_missing_repository_env_exits_1(self):
        env = {k: v for k, v in os.environ.items() if k != "GITHUB_REPOSITORY"}
        r = subprocess.run(
            [sys.executable, str(SCRIPT), "link-pr-issues", "--pr", "1", "--issue-numbers", "1"],
            capture_output=True, text=True, encoding="utf-8", env=env,
        )
        self.assertEqual(r.returncode, 1)

    def test_missing_token_exits_1(self):
        env = {**os.environ, "PYTHONIOENCODING": "utf-8", "GITHUB_REPOSITORY": "o/r", "GITHUB_TOKEN": ""}
        r = subprocess.run(
            [sys.executable, str(SCRIPT), "link-pr-issues", "--pr", "1", "--issue-numbers", "1"],
            capture_output=True, text=True, encoding="utf-8", env=env,
        )
        self.assertEqual(r.returncode, 1)

    def test_empty_issue_numbers_exits_0_without_api_call(self):
        env = {**os.environ, "PYTHONIOENCODING": "utf-8", "GITHUB_REPOSITORY": "o/r", "GITHUB_TOKEN": "x"}
        r = subprocess.run(
            [sys.executable, str(SCRIPT), "link-pr-issues", "--pr", "1", "--issue-numbers", ""],
            capture_output=True, text=True, encoding="utf-8", env=env,
        )
        self.assertEqual(r.returncode, 0)



class TestLinkPrIssuesSkipsMissingIssues(unittest.TestCase):
    def setUp(self):
        self.calls = []

    def fake_api(self, issues):
        def _api(method, url, token, body=None):
            self.calls.append((method, url, body))
            if "/issues/" in url:
                n = url.rsplit("/", 1)[1]
                return issues.get(n, (404, None))[0], issues.get(n, (404, None))[1], None
            if method == "GET":
                return 200, {"body": "본문"}, None
            return 200, {}, None
        return _api

    def test_nonexistent_issue_is_not_added_as_closes(self):
        api = self.fake_api({"12": (200, {"number": 12})})
        with patch.object(issue_helper, "_api_request", side_effect=api), \
                patch("sys.stderr") as err:
            issue_helper.link_pr_issues("o", "r", 5, ["12", "99"], "t", False)
        patched = [c for c in self.calls if c[0] == "PATCH"]
        self.assertEqual(len(patched), 1)
        self.assertIn("Closes #12", patched[0][2]["body"])
        self.assertNotIn("Closes #99", patched[0][2]["body"])
        written = "".join(str(c.args[0]) for c in err.write.call_args_list)
        self.assertIn("::warning::", written)

    def test_pull_request_number_is_skipped(self):
        api = self.fake_api({"7": (200, {"number": 7, "pull_request": {"url": "x"}})})
        with patch.object(issue_helper, "_api_request", side_effect=api), patch("sys.stderr"):
            issue_helper.link_pr_issues("o", "r", 5, ["7"], "t", False)
        self.assertFalse([c for c in self.calls if c[0] == "PATCH"])

    def test_lookup_error_keeps_number(self):
        api = self.fake_api({"12": (500, None)})
        with patch.object(issue_helper, "_api_request", side_effect=api), patch("sys.stderr"):
            issue_helper.link_pr_issues("o", "r", 5, ["12"], "t", False)
        patched = [c for c in self.calls if c[0] == "PATCH"]
        self.assertIn("Closes #12", patched[0][2]["body"])


class TestMessagesLanguage(unittest.TestCase):
    """User-facing text follows PROJECT_AUTO_WIZARD_LANG; parsing stays language-neutral."""

    EVENT = {"action": "opened", "issue": {"number": 7, "title": "[Bug] Crash on start",
                                            "html_url": "https://github.com/o/r/issues/7"}}

    def _run_comment_body(self, lang):
        captured = {}
        with tempfile.TemporaryDirectory() as tmp:
            event_path = Path(tmp) / "event.json"
            event_path.write_text(json.dumps(self.EVENT), encoding="utf-8")
            env = {"GITHUB_EVENT_PATH": str(event_path), "GITHUB_REPOSITORY": "o/r",
                   "GITHUB_TOKEN": "x", "PROJECT_AUTO_WIZARD_LANG": lang}
            with patch.dict(os.environ, env), \
                 patch.object(issue_helper, "upsert_comment",
                              side_effect=lambda *a: captured.update(body=a[5], marker=a[4])), \
                 patch.object(issue_helper, "create_branch_if_needed"):
                os.environ.pop("ISSUE_HELPER_COMMIT_TEMPLATE", None)
                self.assertEqual(issue_helper.cmd_run(), 0)
        return captured

    def test_comment_body_english(self):
        body = self._run_comment_body("en")["body"]
        self.assertIn("## Issue Helper\n### Branch name\n```\n", body)
        self.assertIn("### Commit message\n```\nCrash_on_start : feat : {description of the change} https://github.com/o/r/issues/7\n```", body)
        self.assertFalse(any("\uac00" <= ch <= "\ud7a3" for ch in body))

    def test_comment_body_korean_unchanged(self):
        captured = self._run_comment_body("ko")
        self.assertIn("### 브랜치명\n```\n", captured["body"])
        self.assertIn("### 커밋 메시지\n```\nCrash_on_start : feat : {변경 사항에 대한 설명}", captured["body"])
        # The marker (used to find the comment again) is the same in every language
        self.assertEqual(captured["marker"], issue_helper.COMMENT_MARKER_DEFAULT)

    def test_existing_comment_found_by_marker_regardless_of_language(self):
        old_ko_body = issue_helper.COMMENT_MARKER_DEFAULT + "\n## Issue Helper\n### 브랜치명\n```\nx\n```"
        calls = []

        def api(method, url, token, body=None):
            calls.append(method)
            if method == "GET":
                return 200, [{"id": 5, "body": old_ko_body}], None
            return 200, {}, None

        with patch.dict(os.environ, {"PROJECT_AUTO_WIZARD_LANG": "en"}), \
             patch.object(issue_helper, "_api_request", side_effect=api):
            issue_helper.upsert_comment("o", "r", 7, "tok", issue_helper.COMMENT_MARKER_DEFAULT, "new body")
        self.assertEqual(calls, ["GET", "PATCH"])

    def test_missing_token_message_per_language(self):
        base = {"action": "opened", "issue": {"number": 1, "title": "t", "html_url": "u"}}
        en = run_cli(base, env_extra={"GITHUB_TOKEN": "", "PROJECT_AUTO_WIZARD_LANG": "en"})
        ko = run_cli(base, env_extra={"GITHUB_TOKEN": "", "PROJECT_AUTO_WIZARD_LANG": "ko"})
        self.assertIn("ERROR: GITHUB_TOKEN is not set.", en.stderr)
        self.assertIn("ERROR: GITHUB_TOKEN이 없습니다.", ko.stderr)


if __name__ == "__main__":
    unittest.main()
