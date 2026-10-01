<div align="center">

[English](README.md) · [한국어](README.ko.md) · [简体中文](README.zh-CN.md) · **日本語**

# project-auto-wizard

**コマンド 1 つで、バージョン管理、CHANGELOG、GitHub Release、CI/CD をリポジトリに導入します。**

インストールされるのは、すべてあなた自身のリポジトリ内の通常の GitHub Actions です。API キーもホスティングサービスも不要です。

[ドキュメント](https://twin-fang.github.io/project-auto-wizard/ja/) · [クイックスタート](#quickstart) · [変更履歴](CHANGELOG.md)

[![CI](https://github.com/Twin-Fang/project-auto-wizard/actions/workflows/CI.yaml/badge.svg)](https://github.com/Twin-Fang/project-auto-wizard/actions/workflows/CI.yaml)
[![npm version](https://img.shields.io/npm/v/project-auto-wizard)](https://www.npmjs.com/package/project-auto-wizard)
[![npm downloads](https://img.shields.io/npm/dm/project-auto-wizard)](https://www.npmjs.com/package/project-auto-wizard)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20.12-brightgreen)](package.json)

<img src="https://raw.githubusercontent.com/Twin-Fang/project-auto-wizard/main/assets/demo/install.gif" alt="ウィザードで Spring プロジェクトにリリース自動化をインストールする様子" width="800">

</div>

## 最新バージョン

最新バージョンと変更履歴の全文は [CHANGELOG.md](CHANGELOG.md) を参照してください。

## なぜ作ったか

新しいプロジェクトでは、最初の機能を作る前に毎回同じ作業が発生します。バージョンの上げ方を決め、CHANGELOG を管理し、リリースノートを書き、リリースにタグを付け、前のプロジェクトから CI/CD ワークフローをコピーして手直しします。数時間かかり、リポジトリごとに少しずつ違うものになります。

project-auto-wizard は、この設定をいくつかの質問で一度に済ませます。その後は、リリース PR をマージするだけでリリースが完了します。

<a id="quickstart"></a>

## クイックスタート

リポジトリのルートで実行します（Node.js 20.12 以上）:

```bash
npx project-auto-wizard
```

プロジェクトタイプを検出し、いくつかの質問（ブランチ戦略、デプロイ方式、要約に Copilot を使うか）をしてからファイルを書き込みます。CI やスクリプトからは非対話モードで実行します:

```bash
npx project-auto-wizard --mode full --force --type spring,react
npx project-auto-wizard --mode full --force --type node --dry-run   # preview only, writes nothing
```

生成されたファイルをコミットして push してください。`npx project-auto-wizard --mode doctor` は、ワークフローが依存するリポジトリ設定を確認します。

メッセージの言語は英語または韓国語（`en` | `ko`）です。`--lang`、環境変数 `PROJECT_AUTO_WIZARD_LANG`、`version.yml` の `language` の順に優先されます。環境変数はその実行にのみ適用され、有効な保存済み `language` は上書きしません（有効な値がない場合のみ保存）。上書きするには `--lang` を使います。

## インストールされるもの

| インストール対象 | 用途 |
|---|---|
| `.github/workflows/PROJECT-COMMON-*.yaml` | リリース自動化: バージョン更新、リリース PR のノート、CHANGELOG、タグと GitHub Release、README のバージョン行、PR 要約コメント、新しい issue へのブランチ名の提案 |
| `.github/workflows/PROJECT-<TYPE>-*` | 使用するスタック（Spring、Flutter、React、Next.js、Python、Go）向けの CI/CD |
| `.github/scripts/*.py` | ワークフローの実処理。標準ライブラリのみの Python |
| `version.yml` | バージョン、プロジェクトタイプ、パス、ブランチ、オプションの単一の情報源 |
| `README.md` のバージョンセクション | リリースのたびに最新の状態へ更新 |

これらのファイルはあなたのものなので、自由に読んだり編集したりできます。ウィザードを再実行すると更新されます。編集済みのファイルは、上流のバージョンが変わっていなければそのまま残り、双方が変わっている場合は、自分のファイルを残す、バックアップして置き換える、新しいバージョンを横に追加する、のいずれかを選べます。

デフォルトの `pr-flow` 戦略でのリリースの流れ:

```
feature PRs ──▶ develop ──▶ release PR (develop → main)
                              │  next version from commit types: feat → minor, ! → major, else patch
                              │  release notes written, CHANGELOG.md / CHANGELOG.json updated
                              ▼
                           automerge ──▶ tag vX.Y.Z + GitHub Release ──▶ README version updated
```

`trunk-based`（リリースブランチ = 開発ブランチ）では、リリースブランチへの push ごとに、同じ手順が 1 つのワークフローで実行されます。

リリースノートはデフォルトでルールベースです。GitHub Copilot（Copilot AI Credits を消費します）を有効にすることも、OpenAI 互換の API を指定することもできます。モデルが使えない場合や失敗した場合はルールベースに戻るため、要約の手順が原因でリリースが止まることはありません。

## 導入前と導入後

| | 導入前 | project-auto-wizard を使うと |
|---|---|---|
| 初期設定 | 古いリポジトリからワークフローをコピーして調整 | `npx project-auto-wizard` を実行し、いくつかの質問に答える |
| 次のバージョン | 手で決めて手で入力 | リリース PR のコミットタイプから算出 |
| CHANGELOG | 手書きで、省かれがち | リリース PR のマージ時に更新 |
| タグと Release | 手動で作成 | マージ後に自動作成 |
| スタックごとの CI/CD | プロジェクトごとに作成 | 検出したタイプ向けにインストール |
| AI 要約 | API キーと独自スクリプトが必要 | 任意。ルールベースならキー不要 |

## 他のツールとの比較

| | project-auto-wizard | release-please | semantic-release | changesets |
|---|---|---|---|---|
| 導入方法 | 編集可能なワークフローファイルをインストール | GitHub Action + 設定 | CI で実行する npm パッケージ + プラグイン | CLI + GitHub Action |
| バージョンの決定基準 | コミットタイプ（Conventional でないコミット → patch） | Conventional Commits | Conventional Commits（設定可能） | 開発者が書く changeset ファイル |
| リリース PR | あり（または trunk-based） | あり | なし。push 時にリリース | あり（"Version Packages"） |
| npm / PyPI への公開 | しない | しない | プラグインで可能 | 可能（npm） |
| スタックごとの CI/CD を含む | 含む（プロジェクトタイプ別） | なし | なし | なし |
| モノレポ | タイプ別のパス、共通の 1 つのバージョン | パッケージごとのバージョン | コミュニティプラグイン | パッケージごとのバージョン |

他のツールのほうが優れている点:

- **release-please** は成熟していて広く使われており、多くのエコシステムのバージョンファイルを更新でき、モノレポで独立したバージョンのパッケージも扱えます。
- **semantic-release** は手作業なしで npm などのレジストリに公開でき、プラグインのエコシステムが大きいです。
- **changesets** は、多数のパッケージを公開する JavaScript のモノレポに最適で、変更内容をコミットから導出せず人が書きます。

## 使うべきとき、使わないとき

次の場合に使います:

- リポジトリを新しく始め、初日からリリースが動く状態にしたい
- チームが `develop` を `main` にマージしていて、ノートと CHANGELOG 付きのリリース PR がほしい
- Spring、Flutter、React、Next.js、Python、Go のプロジェクトで、CI/CD とリリース自動化を 1 回の設定で導入したい
- 1 つのリポジトリに複数のスタック（例: Spring のバックエンドと React のフロントエンド）があり、バージョンを共有している

次の場合は使いません:

- 単一パッケージがすでに release-please や semantic-release で問題なくリリースできている
- リリース自体がパッケージレジストリへの公開を伴う必要がある（このリポジトリが npm 向けにしているように、Release イベントで動く独自のワークフローを追加してください。`GITHUB_TOKEN` で作成したリリースは他のワークフローを起動しないため、`WORKFLOW_PAT` が必要です）
- パッケージごとに独立したバージョンが必要
- リポジトリが GitHub 上にない

## 対応するプロジェクトタイプ

| タイプ | 検出元 | リリース自動化に加えてインストールされるもの |
|---|---|---|
| `spring` | `build.gradle`、`build.gradle.kts`、`pom.xml` | CI、サーバーへのデプロイ（単一サーバー / Nginx または Traefik によるダウンタイムなし）、PR プレビュー |
| `flutter` | `pubspec.yaml` | CI、Android（Firebase、Play Store、セルフホスト、テスト用 APK）、iOS TestFlight |
| `react`（React / Next.js） | `package.json` の `react` または `next` dependency | CI、CI + CD |
| `python` | `pyproject.toml`、`setup.py`、`requirements.txt` | CI、PR プレビュー、サーバーへのデプロイ |
| `go` | `go.mod` | CI、PR プレビュー、サーバーへのデプロイ |
| `node`、`react-native`、`react-native-expo`、`basic` | `package.json` / フォールバック | リリース自動化のみ |

1 つのリポジトリに複数のタイプを置けます（`--type spring,react`）。モノレポのサブフォルダーは `--paths "flutter=app,react=client"` で指定します。

<a id="post-install"></a>

## インストール後に確認すること

| 項目 | すること |
|---|---|
| Workflow permissions | インストールされるワークフローは、必要な権限を自分で宣言します。自分のワークフローがデフォルト値に依存している場合のみ、Settings → Actions → General → Workflow permissions を **Read and write permissions** に設定してください |
| Merge commit | リリース PR が automerge できるよう、merge commit を許可してください |
| `WORKFLOW_PAT`（任意） | なくても、`GITHUB_TOKEN` によるフォールバックが約 20 秒後に、リリースブランチのデプロイワークフローを含めてリリースを完了させます。Release イベントで起動する独自のワークフローを追加する場合のみ必要です。bot または machine アカウントで発行してください（scopes: `repo`、`workflow`） |
| Copilot 要約（任意） | デフォルトはオフ。Copilot AI Credits を消費します。組織では、組織に課金される Copilot CLI を許可する必要があります |

<a id="flutter-store"></a>

Flutter のストアデプロイ（Play Store、Firebase、TestFlight）の設定は、[ドキュメントサイトの Flutter ページ](https://twin-fang.github.io/project-auto-wizard/project-types/flutter/)にあります。

## ドキュメント

ドキュメント全体は [twin-fang.github.io/project-auto-wizard](https://twin-fang.github.io/project-auto-wizard/ja/) にあり、英語と韓国語で読めます。中国語（簡体字）と日本語はトップページとクイックスタートのみで、それ以外のページは英語で表示されます。内容は次のとおりです:

- すべての CLI オプション、`--mode status`、`--mode doctor`、`--dry-run`、`--mode uninstall`
- Flutter のストアデプロイ、デプロイモード、必要な secret、`ExportOptions.plist`
- リリースノートエンジンのチェーンと Copilot の課金
- タイプごとのワークフローの詳細、実行ログ、設計方針、アーキテクチャ

## コントリビュート

issue と pull request を歓迎します。`develop` からブランチを作り、`develop` に対して PR を開いてください。セットアップとテスト（`npm test`）は [CONTRIBUTING.md](CONTRIBUTING.md) を参照してください。このリポジトリは、自身がインストールするワークフローで自分自身をリリースしています。

## 由来と謝辞

このプロジェクトは [Cassiiopeia/projectops](https://github.com/Cassiiopeia/projectops)（MIT、Copyright (c) 2025 Cassiiopeia）の GitHub Actions 自動化テンプレートから発展しました。ワークフローの構成や名前の一部（例: `PROJECT-COMMON-*` ワークフロー）はその成果を引き継いでおり、project-auto-wizard はそれを `npx` インストーラーとして再構成し拡張したものです。原作の著作権表示は [LICENSE](LICENSE) に残しています。

## ライセンス

[MIT](LICENSE)
