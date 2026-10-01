---
title: FAQ
description: Common questions and problems.
---

## Do I need an API key?

No. Release notes are rule-based by default. Copilot uses the Actions `GITHUB_TOKEN`, and your own AI API is optional. See [Summary engine](../../understand/summary-engine/).

## Do I need `WORKFLOW_PAT`?

No. Without it, a `GITHUB_TOKEN` fallback finishes automerge, tag, Release and the release-branch deploys, up to about 20 seconds later. You need it only if another workflow must run on the `release: published` event (for example publishing to npm), because events created by `GITHUB_TOKEN` do not trigger other workflows. Issue it from a bot or machine account (scopes: `repo`, `workflow`).

## The release PR does not automerge.

Check that merge commits are allowed in the repository settings. `npx project-auto-wizard --mode doctor` checks this. Also check that the PR is from the development branch to the release branch configured in `version.yml`.

## Should I raise workflow permissions to "Read and write"?

Not for the installed workflows; each declares its own `permissions`. Raise it only if your own workflows omit `permissions` and need to write.

## A deploy workflow fails right after checkout.

The deploy and preview workflows check the required secrets and the `Dockerfile` first. The error names what is missing. Register the secrets under Settings → Secrets and variables → Actions. If the project does not deploy to a server, delete the deploy workflow or re-install with `--deploy-style none`.

## Which check should branch protection require?

Only **`CI Gate`** (`ci-gate`). The CI workflows always run and skip jobs internally when the project path did not change; requiring individual jobs, or relying on workflow-level `paths` filters, can leave a check pending and block the merge.

## My commits do not follow Conventional Commits.

That is fine. Unclassified commits count as patch. Summaries fall back to a plain bullet list. If a user AI API or Copilot is configured, it may upgrade a patch release to minor, never to major.

## How do I force a minor or major release?

Use `feat:` for minor, or `!` (`feat!:`) / a `BREAKING CHANGE:` footer for major. With `semver_auto: false`, edit major/minor in `version.yml` by hand; the workflows only bump patch.

## I edited an installed workflow. Will an update overwrite it?

No. If the payload did not change that file, your version is kept. If both changed, you choose to keep yours, replace it with a `.bak` backup, or add the new version alongside. With `--force`, yours is kept. See [Updating](../../operate/updating/).

## `--mode status` says I changed a file I never touched.

If you answered a prompt with a non-default value (for example a deploy port), the file differs from the default template and is reported as changed. See [status](../../operate/status/#how-drift-is-decided).

## Does the wizard send data anywhere?

The wizard makes no network requests of its own. Only git and gh commands against your repository reach the network: default-branch detection, pushing a new development branch, and `gh api` calls in `--mode doctor`. When Copilot or your AI API is enabled, the workflows send the PR title, commit subjects and `git diff --stat` to that service.

## Can it publish to npm, PyPI or an app store?

It does not publish packages. It ends with a tag and a GitHub Release; add your own workflow on the Release event to publish. Flutter store uploads (Play Store, TestFlight) are separate workflows installed for Flutter.

## Does it work outside GitHub?

No. Everything it installs is GitHub Actions.

## Is the CLI available in English?

Yes. The interactive wizard asks for the language first when none is set, English or Korean, and non-interactive runs default to English. Pass `--lang ko` or set `PROJECT_AUTO_WIZARD_LANG=ko` to skip the question. Flags, file names and workflow names are the same in any language.
