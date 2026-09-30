---
title: Flutter
description: CI, Android and iOS deployment, environment variables, deploy modes and required secrets for Flutter apps.
---

Detected from `pubspec.yaml`. Installed on top of [release automation](../common/).

<a id="flutter-store"></a>

## Installed workflows

| Workflow | Installed | Trigger | What it does |
|---|---|---|---|
| `PROJECT-FLUTTER-CI` | always | PR and push to the development branch, `workflow_dispatch` | `flutter analyze` and Android/iOS build checks, progress comment on PRs |
| `PROJECT-FLUTTER-ANDROID-FIREBASE-CICD` | always | Push to the release branch, `workflow_dispatch` | AAB build, upload to Firebase App Distribution |
| `PROJECT-FLUTTER-ANDROID-SELFHOSTED-CICD` | always | Push to the release branch, `workflow_dispatch` | APK build, copy to an SMB share on your own server |
| `PROJECT-FLUTTER-ANDROID-TEST-APK` | always | `workflow_dispatch`, `repository_dispatch` | Test APK from a feature branch, uploaded as an artifact (and to Firebase if configured) |
| `PROJECT-FLUTTER-APP-BUILD-TRIGGER` | always | Issue and PR comments | Starts test builds from a comment (see below) |
| `PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD` | Android selected | Push to the release branch, `workflow_dispatch` | AAB build, upload to Google Play |
| `PROJECT-FLUTTER-IOS-TESTFLIGHT` | iOS selected | Push to the release branch, `workflow_dispatch` | IPA build, upload to TestFlight / App Store Connect |
| `PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT` | iOS selected | `workflow_dispatch`, `repository_dispatch` | Test build from a feature branch to TestFlight |

Selecting Android also creates `android/fastlane/Fastfile.playstore`. Selecting iOS creates `ios/fastlane/Fastfile` and `ios/ExportOptions.plist`.

- fastlane is only used by the store workflows. `SELFHOSTED` and `TEST-APK` run `flutter build apk --release` directly and do not install Ruby or fastlane.
- `Fastfile` and `ExportOptions.plist` are created relative to the Flutter root (with `--paths flutter=app`, under `app/`) **only if they do not exist**. Existing files are never overwritten; the install summary and `--dry-run` show them as kept.
- `--mode uninstall` removes only the files the wizard created and that you did not change.
- If you deselect a store target and re-run, the store workflow is cleaned up the same way as a deploy-style change: untouched files are deleted, edited ones moved to `.bak`. `Fastfile` and `ExportOptions.plist` are never deleted.

### Build from a comment

`PROJECT-FLUTTER-APP-BUILD-TRIGGER` listens for comments on PRs and issues:

```
/wizard app build   Android + iOS
/wizard apk build   Android only
/wizard ios build   iOS only
/wizard apk build 20260609_#349_feature   build a specific branch
```

Word order does not matter (`build app` works too). Without a branch name, the PR head branch, or for an issue the branch from the Issue Helper comment, is used.

## Options the wizard asks

When the project includes `flutter`, the wizard asks three more things. The answers are saved in `version.yml` under `metadata.template.options` (`env_mode`, `flutter_store`, `android_deploy_mode`, `ios_deploy_mode`) and are not asked again. To change them later, use **Edit → environment variable mode / store targets / deploy mode** in the confirmation screen, or the flags.

| Option | Values | Default | Flag |
|---|---|---|---|
| Environment variable mode | `dart-define` / `dotenv` | `dart-define` for new installs. An existing `version.yml` without a saved value keeps `dotenv` to preserve the old behavior. | `--flutter-env-mode` |
| Store targets | Android (Play Store) / iOS (TestFlight), multi-select | Interactive new install: nothing selected. Non-interactive without the flag: both. Existing installs without a saved value infer it from the store workflows present. | `--flutter-store android,ios,none` |
| Deploy mode | per platform: `store_only` / `store_prepare` / `store_submit` | `store_only` | `--android-deploy-mode`, `--ios-deploy-mode` |

### Environment variable mode

Both modes read a `.env`-style secret `ENV_FILE` (or `ENV` if `ENV_FILE` is missing). There is no mode that uses both at once.

- **`dart-define`** writes `ENV_FILE` to a temporary path outside the project and passes it to every `flutter build` with `--dart-define-from-file`. No `.env` is created in the project root. Read values with `String.fromEnvironment('KEY')`. Only the file path is on the command line, so values do not appear in `--verbose` logs.
- **`dotenv`** writes `.env` in the Flutter root before building (before `build_runner` runs). For projects using `flutter_dotenv` or `envied`. The parser limits below do not apply.

With `dart-define`, `ENV_FILE` is parsed by Flutter's `--dart-define-from-file` (based on `DotEnvRegex` in Flutter 3.47.5 `flutter_tools/lib/src/runner/flutter_command.dart`):

- Content starting with `{` is read as JSON; otherwise as `KEY=value` lines. Keys must match `[a-zA-Z_][a-zA-Z0-9_]*`.
- Comment lines starting with `#` and blank lines are ignored.
- `"…"`, `'…'` and `` `…` `` quotes are stripped, and a trailing `# comment` is removed. Unquoted values end at whitespace or `#`; `=` inside a value is allowed.
- `export KEY=value` and multi-line (`"""`) values are not supported and fail the build.

### Deploy mode

Unknown values are treated as `store_only`. The repository variables `ANDROID_DEPLOY_MODE` / `IOS_DEPLOY_MODE` and the `workflow_dispatch` input always take precedence over the installed default.

| Mode | Play Store (Android) | TestFlight / App Store (iOS) |
|---|---|---|
| `store_only` | Upload to the internal track | Upload to TestFlight |
| `store_prepare` | Upload to the production track as a draft (release it in Play Console) | Prepare the app version and metadata, no review submission |
| `store_submit` | Submit to review on the production track | Submit to review |

With `store_submit`, **every push to the release branch submits a review.**

## Secrets and variables

The install summary and the run log list the secrets your installed workflows actually need.

| Target | Secrets | Variables |
|---|---|---|
| Flutter build (all) | `ENV_FILE` (or `ENV`) — required for `PLAYSTORE`, `FIREBASE`, `SELFHOSTED`; optional for CI, `TEST-APK` and iOS | — |
| Android signing (`PLAYSTORE`, `FIREBASE`, `TEST-APK`) | `RELEASE_KEYSTORE_BASE64`, `RELEASE_KEYSTORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD` (`TEST-APK` falls back to a debug key with a warning) | — |
| Firebase config file (`PLAYSTORE`, `FIREBASE`, `TEST-APK`, `SELFHOSTED`) | `GOOGLE_SERVICES_JSON` (optional) | — |
| Play Store (`PLAYSTORE`) | `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64`, `ANDROID_PACKAGE_NAME` (secret or variable) | `ANDROID_PACKAGE_NAME` (used when the secret is missing), `ANDROID_DEPLOY_MODE` (optional) |
| iOS (`IOS-TESTFLIGHT`, `IOS-TEST-TESTFLIGHT`) | `APP_STORE_CONNECT_API_KEY_BASE64`, `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APPLE_CERTIFICATE_BASE64`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_PROVISIONING_PROFILE_BASE64`, `IOS_PROVISIONING_PROFILE_NAME`, `IOS_BUNDLE_ID` (`IOS-TESTFLIGHT` only, secret or variable), `SECRETS_XCCONFIG` (optional) | `IOS_BUNDLE_ID` (used when the secret is missing), `IOS_DEPLOY_MODE` (optional) |
| Firebase App Distribution (`FIREBASE`, `TEST-APK`) | `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` (optional for `TEST-APK` — uploads only if set) | — |
| Self-hosted (`SELFHOSTED`) | `SERVER_HOST`, `SERVER_USER`, `SERVER_PASSWORD`, `DEBUG_KEYSTORE` (optional — without it every build is signed with a new debug key) | — |

`ANDROID_PACKAGE_NAME` is passed to fastlane as the package name (secret first, then variable), the same pattern as `IOS_BUNDLE_ID` on iOS.

`FIREBASE_APP_ID` and `FIREBASE_TESTER_GROUP` are not secrets; edit them in the `env` section of the Firebase workflow.

### ExportOptions.plist placeholders

The generated `ios/ExportOptions.plist` contains placeholders to replace. If they are left in, `IOS-TESTFLIGHT` stops in its validation step with a message saying so, instead of an obscure `xcodebuild` error. `--mode doctor` reports them as WARN.

| Placeholder | Replace with |
|---|---|
| `__TEAM_ID__` | Apple Developer Team ID |
| `__BUNDLE_ID__` | App bundle ID (same as `IOS_BUNDLE_ID`) |
| `__PROVISIONING_PROFILE_NAME__` | Provisioning profile name (same as `IOS_PROVISIONING_PROFILE_NAME`) |

## Monorepo and ci-gate

- With a subfolder such as `--paths flutter=app`, all Flutter workflows work from that folder (`FLUTTER_PROJECT_DIR`). Deploy workflows on the release branch (`PLAYSTORE`, `IOS-TESTFLIGHT`, `SELFHOSTED`, `FIREBASE`) only run when `app/**` changes.
- CI always runs on its triggers; the first job `changes` decides whether to skip the rest (skipped counts as success). The last job `ci-gate` always runs and fails only on a failed or cancelled job.
- Register only **`CI Gate`** (`ci-gate`) as the required status check in branch protection.
- `paths` filters do not apply to tag pushes (GitHub behavior).

## Gemfile

The store workflows (`PLAYSTORE`, `IOS-TESTFLIGHT`, `IOS-TEST-TESTFLIGHT`) use your `Gemfile` if it lists `fastlane`, and create one at run time otherwise. The wizard does not ship a Gemfile template. As fastlane recommends, committing a `Gemfile` (`gem "fastlane"`) and `Gemfile.lock` pins the version and makes builds reproducible.
