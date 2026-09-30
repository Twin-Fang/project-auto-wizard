<div align="center">

[English](README.md) · [한국어](README.ko.md) · **简体中文** · [日本語](README.ja.md)

# project-auto-wizard

**一条命令，为你的仓库配置版本管理、CHANGELOG、GitHub Release 和 CI/CD。**

它安装的全部内容都是你自己仓库里的普通 GitHub Actions。不需要 API 密钥，也没有托管服务。

[文档](https://twin-fang.github.io/project-auto-wizard/zh-cn/) · [快速开始](#quickstart) · [变更日志](CHANGELOG.md)

[![CI](https://github.com/Twin-Fang/project-auto-wizard/actions/workflows/CI.yaml/badge.svg)](https://github.com/Twin-Fang/project-auto-wizard/actions/workflows/CI.yaml)
[![npm version](https://img.shields.io/npm/v/project-auto-wizard)](https://www.npmjs.com/package/project-auto-wizard)
[![npm downloads](https://img.shields.io/npm/dm/project-auto-wizard)](https://www.npmjs.com/package/project-auto-wizard)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20.12-brightgreen)](package.json)

<img src="https://raw.githubusercontent.com/Twin-Fang/project-auto-wizard/main/assets/demo/install.gif" alt="使用向导为 Spring 项目安装发布自动化" width="800">

</div>

## 最新版本

最新版本和完整的变更记录见 [CHANGELOG.md](CHANGELOG.md)。

## 为什么做这个

每个新项目在写第一个功能之前，都要先做同样的杂事：决定版本怎么递增，维护 CHANGELOG，撰写发布说明，给发布打标签，再把上一个项目的 CI/CD 工作流复制过来修修改改。这要花几个小时，而且每个仓库最后都会略有不同。

project-auto-wizard 用几个提问一次性完成这些配置。之后只要合并发布 PR，就能完成一次发布。

<a id="quickstart"></a>

## 快速开始

在仓库根目录运行（需要 Node.js 20.12 或更高版本）：

```bash
npx project-auto-wizard
```

它会检测项目类型，询问几个问题（分支策略、部署方式、是否使用 Copilot 生成摘要），然后写入文件。在 CI 或脚本中，可以用非交互方式运行：

```bash
npx project-auto-wizard --mode full --force --type spring,react
npx project-auto-wizard --mode full --force --type node --dry-run   # preview only, writes nothing
```

提交生成的文件并 push。`npx project-auto-wizard --mode doctor` 会检查工作流所依赖的仓库设置。

消息语言为英语或韩语（`en` | `ko`）。可通过 `--lang`、环境变量 `PROJECT_AUTO_WIZARD_LANG` 或 `version.yml` 中的 `language` 指定，优先级依次降低。

## 安装内容

| 安装项 | 用途 |
|---|---|
| `.github/workflows/PROJECT-COMMON-*.yaml` | 发布自动化：版本递增、发布 PR 说明、CHANGELOG、标签和 GitHub Release、README 版本行、PR 摘要评论、为新 issue 建议分支名 |
| `.github/workflows/PROJECT-<TYPE>-*` | 对应技术栈（Spring、Flutter、React、Next.js、Python、Go）的 CI/CD |
| `.github/scripts/*.py` | 工作流背后的逻辑，仅使用标准库的 Python |
| `version.yml` | 版本、项目类型、路径、分支和选项的唯一来源 |
| `README.md` 版本部分 | 每次发布后自动更新 |

这些文件归你所有，可以随意阅读和修改。再次运行向导会更新它们：如果上游版本没有变化，你修改过的文件会被保留；如果双方都有变化，向导会询问是保留你的文件、备份后替换，还是把新版本放在旁边。

默认的 `pr-flow` 策略下，一次发布的流程如下：

```
feature PRs ──▶ develop ──▶ release PR (develop → main)
                              │  next version from commit types: feat → minor, ! → major, else patch
                              │  release notes written, CHANGELOG.md / CHANGELOG.json updated
                              ▼
                           automerge ──▶ tag vX.Y.Z + GitHub Release ──▶ README version updated
```

使用 `trunk-based`（发布分支 = 开发分支）时，每次 push 到发布分支，都会在一个工作流中执行相同的步骤。

发布说明默认基于规则生成。你可以开启 GitHub Copilot（消耗你的 Copilot AI Credits），或者指向任何兼容 OpenAI 的 API。如果模型不可用或调用失败，会回退到规则生成，因此发布不会被摘要步骤卡住。

## 使用前后对比

| | 不使用 | 使用 project-auto-wizard |
|---|---|---|
| 初始配置 | 从旧仓库复制工作流并修改 | 运行 `npx project-auto-wizard`，回答几个问题 |
| 下一个版本号 | 手动决定并输入 | 根据发布 PR 中的提交类型得出 |
| CHANGELOG | 手写，经常被跳过 | 发布 PR 合并时更新 |
| 标签和 Release | 手动创建 | 合并后自动创建 |
| 各技术栈的 CI/CD | 每个项目单独编写 | 按检测到的类型安装 |
| AI 摘要 | 需要 API 密钥和自定义脚本 | 可选；基于规则的方式无需密钥 |

## 与其他工具的比较

| | project-auto-wizard | release-please | semantic-release | changesets |
|---|---|---|---|---|
| 接入方式 | 安装可编辑的工作流文件 | GitHub Action + 配置 | 在 CI 中运行的 npm 包 + 插件 | CLI + GitHub Action |
| 版本决定依据 | 提交类型（非 Conventional 的提交 → patch） | Conventional Commits | Conventional Commits（可配置） | 开发者编写的 changeset 文件 |
| 发布 PR | 有（或 trunk-based） | 有 | 没有，push 时直接发布 | 有（"Version Packages"） |
| 发布到 npm / PyPI | 否 | 否 | 是，通过插件 | 是（npm） |
| 包含各技术栈 CI/CD | 是，按项目类型 | 否 | 否 | 否 |
| Monorepo | 按类型划分路径，共用一个版本 | 各包独立版本 | 社区插件 | 各包独立版本 |

其他工具做得更好的地方：

- **release-please** 成熟且被广泛使用，能更新多种生态的版本文件，并支持 monorepo 中独立版本的包。
- **semantic-release** 无需手动步骤即可发布到 npm 等仓库，并且拥有庞大的插件生态。
- **changesets** 最适合发布多个包的 JavaScript monorepo，变更条目由人来写，而不是从提交中推导。

## 何时使用，何时不用

适合使用的情况：

- 你刚开始一个仓库，希望从第一天起就能发布
- 你的团队把 `develop` 合并到 `main`，并希望有带说明和 CHANGELOG 的发布 PR
- 你有 Spring、Flutter、React、Next.js、Python 或 Go 项目，想一次配置好 CI/CD 和发布自动化
- 一个仓库里有多个技术栈（例如 Spring 后端和 React 前端），并共用一个版本

不适合的情况：

- 单个包已经用 release-please 或 semantic-release 发布得很好
- 发布本身必须推送到包仓库（请在 Release 事件上添加你自己的工作流，就像本仓库发布 npm 那样；这需要 `WORKFLOW_PAT`，因为用 `GITHUB_TOKEN` 创建的 Release 不会触发其他工作流）
- 你的包需要独立的版本号
- 仓库不在 GitHub 上

## 支持的项目类型

| 类型 | 检测依据 | 在发布自动化之外额外安装 |
|---|---|---|
| `spring` | `build.gradle`、`build.gradle.kts`、`pom.xml` | CI、服务器部署（单台服务器 / Nginx 或 Traefik 零停机）、PR 预览 |
| `flutter` | `pubspec.yaml` | CI、Android（Firebase、Play Store、自托管、测试 APK）、iOS TestFlight |
| `react`（React / Next.js） | `package.json` 中的 `react` 或 `next` dependency | CI、CI + CD |
| `python` | `pyproject.toml`、`setup.py`、`requirements.txt` | CI、PR 预览、服务器部署 |
| `go` | `go.mod` | CI、PR 预览、服务器部署 |
| `node`、`react-native`、`react-native-expo`、`basic` | `package.json` / 兜底 | 仅发布自动化 |

一个仓库里可以有多种类型（`--type spring,react`），monorepo 的子目录用 `--paths "flutter=app,react=client"` 指定。

<a id="post-install"></a>

## 安装之后

| 事项 | 需要做什么 |
|---|---|
| Workflow permissions | 已安装的工作流会自行声明所需权限。只有当你自己的工作流依赖默认值时，才需要把 Settings → Actions → General → Workflow permissions 设为 **Read and write permissions** |
| Merge commit | 允许 merge commit，发布 PR 才能 automerge |
| `WORKFLOW_PAT`（可选） | 没有它时，`GITHUB_TOKEN` 回退方案会在约 20 秒后完成发布，包括发布分支上的部署工作流。只有当你自己添加了由 Release 事件触发的工作流时才需要。请用 bot 或 machine 账号签发（scopes：`repo`、`workflow`） |
| Copilot 摘要（可选） | 默认关闭。会消耗 Copilot AI Credits；组织需要允许向组织计费的 Copilot CLI |

<a id="flutter-store"></a>

Flutter 商店部署（Play Store、Firebase、TestFlight）的设置见[文档站点的 Flutter 页面](https://twin-fang.github.io/project-auto-wizard/project-types/flutter/)。

## 文档

完整文档位于 [twin-fang.github.io/project-auto-wizard](https://twin-fang.github.io/project-auto-wizard/zh-cn/)，提供英文和韩文版本。简体中文和日文目前涵盖首页和快速开始，其余页面显示英文。内容包括：

- 所有 CLI 选项、`--mode status`、`--mode doctor`、`--dry-run` 和 `--mode uninstall`
- Flutter 商店部署、部署模式、所需的 secret 以及 `ExportOptions.plist`
- 发布说明引擎链和 Copilot 计费
- 各类型的工作流详情、运行日志、设计原则和架构

## 参与贡献

欢迎提交 issue 和 pull request。请从 `develop` 创建分支，并向 `develop` 发起 PR；环境搭建和测试（`npm test`）见 [CONTRIBUTING.md](CONTRIBUTING.md)。本仓库使用它自己安装的工作流来发布自身。

## 许可证

[MIT](LICENSE)
