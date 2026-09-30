# Security Policy

## Supported versions

Only the latest release receives security patches (see `npm view project-auto-wizard version`).

## Reporting a vulnerability

**Do not open a public issue.** If you find a security vulnerability in project-auto-wizard or in the GitHub Actions workflows it generates (for example a secret leak path, command injection or privilege escalation), report it through GitHub's [Private Security Advisory](https://github.com/Twin-Fang/project-auto-wizard/security/advisories/new) feature.

## What to expect

- We review reports as quickly as we can and prioritize by severity.
- Once a fix ships, the security fix is noted in the CHANGELOG and the GitHub Release Notes (anonymously if the reporter prefers).

## Security principles by design

- All installed assets (workflows, scripts, config) come from the `payload/` bundled in the npm package. Nothing remote is downloaded during installation, so the same package version always produces the same result.
- The wizard reads and writes only `payload/` and the repo folder it runs in (`.github/`, `version.yml`, `README.md`, `.gitignore`, etc.).
- The wizard itself makes no network requests. The only network use is the git/gh commands below, all run against your own repo with your own credentials.
  - Default branch detection: `git remote show origin` (when there is no local `origin/HEAD`)
  - Creating the develop branch when the remote has none: `git push -u origin <develop>` (asks first in interactive mode, automatic with `--force`)
  - `--mode doctor`: reads repo settings with `gh auth status`, `gh api` and `gh secret list` (read-only)
- Installed workflows run with only `GITHUB_TOKEN` by default. AI summaries are off by default; when enabled, the GitHub Copilot CLI runs with `GITHUB_TOKEN` (`copilot-requests: write`). Any other secret (`AI_API_KEY`, `WORKFLOW_PAT`, deploy and signing secrets, etc.) is used only if you registered it yourself.
