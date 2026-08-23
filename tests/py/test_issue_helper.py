import json
import os
import subprocess
import sys
import tempfile
import unittest
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

    def test_no_hash_returns_none(self):
        self.assertIsNone(
            issue_helper.extract_issue_number_from_branch("worktree-issue-93-branch-strategy")
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


class TestExtractIssueTitle(unittest.TestCase):
    def test_strips_leading_tag(self):
        self.assertEqual(issue_helper.extract_issue_title("[개선] 제목입니다"), "제목입니다")

    def test_strips_emoji(self):
        self.assertEqual(issue_helper.extract_issue_title("버그 발견 🐛🔥"), "버그 발견")

    def test_strips_variation_selector_and_zwj(self):
        # ZWJ(U+200D)로 연결된 이모지 시퀀스 + 변형 선택자(U+FE0F)
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
        # START만 있고 END가 없는 손상된 상태(수동 편집/이전 실패 실행 등) —
        # 정규식이 매칭하지 못해 아무것도 치환되지 않고 조용히 무효화되는 것을
        # 막기 위해, 완전한 블록이 아니면 "마커 없음"으로 취급해 새 블록을 덧붙인다.
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
            "GITHUB_EVENT_PATH": str(event_path),
            "GITHUB_REPOSITORY": "o/r",
        }
        if env_extra:
            env.update(env_extra)
        return subprocess.run(
            [sys.executable, str(SCRIPT), "run"],
            capture_output=True, text=True, env=env,
        )


class TestRunGuards(unittest.TestCase):
    def test_missing_event_path_exits_1(self):
        env = {k: v for k, v in os.environ.items() if k != "GITHUB_EVENT_PATH"}
        env["GITHUB_REPOSITORY"] = "o/r"
        r = subprocess.run([sys.executable, str(SCRIPT), "run"], capture_output=True, text=True, env=env)
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
        # env_extra는 델타만 넘긴다 — os.environ 전체를 스프레드하면 CI(GitHub Actions
        # 러너)에서 실제 GITHUB_EVENT_PATH가 run_cli의 임시 이벤트 경로를 덮어써
        # 러너 자신의 트리거 이벤트(action이 'opened'가 아님)를 읽게 되어 플레이키해진다.
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
            capture_output=True, text=True,
        )
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "102")

    def test_no_match_prints_nothing(self):
        r = subprocess.run(
            [sys.executable, str(SCRIPT), "extract-branch-issue", "worktree-issue-93-branch-strategy"],
            capture_output=True, text=True,
        )
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "")


class TestLinkPrIssuesCliGuards(unittest.TestCase):
    def test_missing_repository_env_exits_1(self):
        env = {k: v for k, v in os.environ.items() if k != "GITHUB_REPOSITORY"}
        r = subprocess.run(
            [sys.executable, str(SCRIPT), "link-pr-issues", "--pr", "1", "--issue-numbers", "1"],
            capture_output=True, text=True, env=env,
        )
        self.assertEqual(r.returncode, 1)

    def test_missing_token_exits_1(self):
        env = {**os.environ, "GITHUB_REPOSITORY": "o/r", "GITHUB_TOKEN": ""}
        r = subprocess.run(
            [sys.executable, str(SCRIPT), "link-pr-issues", "--pr", "1", "--issue-numbers", "1"],
            capture_output=True, text=True, env=env,
        )
        self.assertEqual(r.returncode, 1)

    def test_empty_issue_numbers_exits_0_without_api_call(self):
        env = {**os.environ, "GITHUB_REPOSITORY": "o/r", "GITHUB_TOKEN": "x"}
        r = subprocess.run(
            [sys.executable, str(SCRIPT), "link-pr-issues", "--pr", "1", "--issue-numbers", ""],
            capture_output=True, text=True, env=env,
        )
        self.assertEqual(r.returncode, 0)


if __name__ == "__main__":
    unittest.main()
