---
title: Summary engine
description: How release notes and PR summaries are written, and how Copilot and your own AI API fit in.
---

Release notes, CHANGELOG entries and PR summary comments all come from the same engine chain in `changelog_manager.py`. **Whatever fails, the release is never blocked.**

```
your AI API  ──not set / failed──▶  GitHub Copilot CLI  ──off / unavailable / failed──▶  rule-based
(AI_API_KEY + AI_API_BASE_URL + AI_MODEL)   (optional, GITHUB_TOKEN)                      (always succeeds)
```

The prompt contains only the PR title, commit subjects and a capped `git diff --stat` (file-level summary, no diff body).

## Rule-based (default)

With nothing configured, summaries are rule-based and need no keys. The rules try three formats in order:

1. the project's own commit convention
2. Conventional Commits
3. a plain bullet list of commits

It works even if the team follows no commit convention.

## GitHub Copilot (optional)

Turn it on in the wizard, with `--copilot`, or by setting `copilot_ai: true` in `version.yml`. The workflows then call the Copilot CLI with the Actions `GITHUB_TOKEN` and `permissions: copilot-requests: write`. No separate API key is needed.

Things to know before enabling it:

- **It consumes GitHub Copilot AI Credits.** Personal repositories bill the repository owner's Copilot seat; organization repositories bill the organization, which must enable the policy "Allow use of Copilot CLI billed to the organization".
- A summary is generated on every push to a PR, so credits are used each time.
- Copilot is always called with `auto` model selection. Copilot Free and Student accounts reject calls that name a model and only allow `auto`, so there is no option to pick a model.
- If Copilot is unavailable, the chain falls through to the rule-based summary.

GitHub recommends Agentic Workflows over calling the Copilot CLI directly in a `run` step. This project calls it directly because the input is limited to the PR title, commit messages and `git diff --stat`; the CLI runs in an empty temporary directory as text generation only, with shell, write and URL tools and built-in MCP servers disabled; and fork PRs are skipped by an existing guard. Together these keep the prompt-injection surface small.

## Your own AI API (optional)

Set all three to use any OpenAI-compatible endpoint (Groq, Gemini's compatible mode, Ollama, and so on). It is tried first:

| Name | Kind |
|---|---|
| `AI_API_KEY` | Secret |
| `AI_API_BASE_URL` | Variable |
| `AI_MODEL` | Variable |

If any of the three is missing, this step is skipped.

GitHub Models is no longer used; it was shut down on 2026-07-30.

## AI and version bumps

AI never decides a major bump. When the rule result is patch and some commits do not follow the convention, a configured AI (your API or Copilot) is asked only whether patch should become minor. With AI off, the rule result stands. See [Release flow](../release-flow/#2-version-confirmed).

## PR summary bot

`PROJECT-COMMON-AI-PR-SUMMARY` posts a summary comment on PRs that target the release branch, using the same chain. It needs no third-party review service.

- **pr-flow:** everyday feature PRs target `develop`, so the bot only matters for PRs into `main`. Release PRs (`develop → main`) are skipped here, because `AUTO-CHANGELOG-CONTROL` already posts the summary with the confirmed version.
- **trunk-based:** every PR targets the release branch, so the bot comments on every PR.

The summary header shows the version the PR is expected to ship in (current version plus the bump that will be applied), not the version already released.
