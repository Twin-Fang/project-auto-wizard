---
title: Branch strategies
description: pr-flow and trunk-based, which workflows each installs, and how to choose.
---

The wizard asks for the branch strategy first. The choice is stored in `version.yml` under `metadata.template.branches` and is not asked again on updates.

```yaml
metadata:
  template:
    branches:
      main: "main"        # release branch
      develop: "develop"  # development branch
      mode: "pr-flow"     # pr-flow | trunk-based
```

## pr-flow (default)

Work lands on a development branch (`develop` by default). A release is a PR from `develop` to the release branch (`main`).

Installed release workflows:

| Workflow | Role |
|---|---|
| `PROJECT-COMMON-AUTO-CHANGELOG-CONTROL` | Release PR: confirm version, notes, CHANGELOG, automerge |
| `PROJECT-COMMON-RELEASE-PUBLISH` | Tag and GitHub Release after the merge |
| `PROJECT-COMMON-VERSION-CONTROL` | Safety net for direct pushes to `main` |

Type CI workflows run on PRs and pushes to `develop`; deploy workflows run on pushes to `main`.

Use it when you want a reviewable release PR with the version and notes visible before anything is tagged.

## trunk-based

The release branch is also the development branch. There is no release PR: every push to the release branch is a release.

Only `PROJECT-COMMON-RELEASE-PUBLISH` is installed for releases (`AUTO-CHANGELOG-CONTROL` and `VERSION-CONTROL` are not). On each push it bumps the version, writes the summary for the commits since the last tag, updates the CHANGELOG, commits with `[skip ci]`, then tags and publishes the Release — the same steps as pr-flow, in one workflow.

The AI PR summary bot comments on every PR in this mode, because every PR targets the release branch.

Because the bot commits the version bump and CHANGELOG straight to the release branch, a branch protection rule or ruleset on it (for example "require a pull request") rejects that push. The run stops at the first rejection with the cause instead of retrying, and no tag or Release is created. Allow the pushing account to bypass the rule (the `WORKFLOW_PAT` owner, or the GitHub Actions bot when no PAT is set), or use `pr-flow`, where the bot only commits to the release PR branch.

Use it for small projects or libraries where every merge to `main` should ship.

## Choosing branches

| | Interactive | Non-interactive |
|---|---|---|
| Release branch | Picked from your branches; defaults to the detected default branch | `--main-branch B` (default: detected default branch) |
| Development branch | Asked only for pr-flow | `--develop-branch B` (default: `develop`) |
| trunk-based | Choose it in the strategy prompt | Pass the same value to `--main-branch` and `--develop-branch` |

If the development branch does not exist, the wizard creates it and pushes it.

An interactive re-run reuses the saved branches without asking. To change them, run non-interactively with the flags — they take precedence over the saved values:

```bash
npx project-auto-wizard --mode full --force --main-branch main --develop-branch main --dry-run
```

Preview with `--dry-run` first, then run without it. Afterwards, check `.github/workflows/` for release workflows the new strategy does not use.
