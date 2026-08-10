import sys
import unittest
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parents[2] / "payload" / "scripts"
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

import issue_helper  # noqa: E402


class TestExtractIssueNumber(unittest.TestCase):
    def test_extracts_trailing_number(self):
        self.assertEqual(issue_helper.extract_issue_number("https://github.com/o/r/issues/68"), "68")

    def test_strips_trailing_slash(self):
        self.assertEqual(issue_helper.extract_issue_number("https://github.com/o/r/issues/68/"), "68")


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


if __name__ == "__main__":
    unittest.main()
