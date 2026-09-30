// CLI 인자 파싱.
import { VALID_TYPES, VALID_MODES } from "../context.js";
import { DEPLOY_STYLES, isDeployStyle, NO_DEPLOY_STYLE } from "../core/deploy-style.js";
import { isValidBranchName } from "../core/branches.js";
import { TYPES } from "../core/types.js";
import { CliError } from "../core/errors.js";
import { normalizePath, isRepoRelativePath } from "../core/paths.js";
import { t, DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, isSupportedLanguage, normalizeLanguage } from "../i18n/index.js";

// 기존 import 경로(cli/args.js) 호환 — 정의는 core에 있다.
export { CliError, normalizePath, isRepoRelativePath };

// 타입 전용 CLI 플래그(타입 훅 cliFlags) — 플래그 이름 → { field, initial, parse }. 훅은 타입 표 순서대로 모은다.
export const TYPE_CLI_FLAGS = TYPES.flatMap((t) => t.hooks?.cliFlags ?? []);
const TYPE_CLI_FLAG_BY_NAME = new Map(TYPE_CLI_FLAGS.map((f) => [f.flag, f]));

// argv(process.argv.slice(2)) → 파싱 결과. 오류 시 throw(호출부에서 exit 1).
export function parseArgs(argv) {
  const result = {
    mode: "interactive",
    version: "",             // 통합 대상 프로젝트의 초기 버전 (--project-version)
    types: [],
    primaryType: "",
    includeSemverAuto: null,  // --semver-auto / --no-semver-auto (기본 true — 미지정 시 다운스트림에서 해석)
    includeCopilotAi: null,   // --copilot / --no-copilot (기본 false — AI Credits를 소비하는 opt-in)
    pathsCsv: "",            // "flutter=app,react=client" 원문 (정규화는 resolve 단계)
    mainBranch: "",          // 릴리스 브랜치 (--main-branch). 빈값=감지된 default branch
    developBranch: "",       // 개발 브랜치 (--develop-branch). 빈값=develop
    deployStyle: "",         // 서버 배포 방식 (--deploy-style). 빈값=version.yml 저장값 → simple
    // 타입 전용 플래그 필드(예: Flutter 환경변수 방식·스토어 대상·배포 모드) — 미지정 값은 타입 훅이 정한다.
    ...Object.fromEntries(TYPE_CLI_FLAGS.map((f) => [f.field, f.initial])),
    lang: "",                // message language (--lang). empty = env var -> saved version.yml value -> en
    force: false,
    help: false,
    showVersion: false,      // -v/--version → 패키지 버전 출력 (npm 관례)
    dryRun: false,        // --dry-run: 실제 변경 없이 미리보기만 (full/uninstall)
    purgeReadme: false,       // --purge-readme: uninstall --force 시 README 버전 섹션도 제거
    purgeGitignore: false,    // --purge-gitignore: uninstall --force 시 .gitignore 자동 추가 항목도 제거
    purgeVersion: false,      // --purge-version: uninstall --force 시 version.yml도 제거
    // purge 전용 플래그 (숨김 모드 — HELP_TEXT에는 노출하지 않는다).
    yes: false,               // --yes: purge 실행 확인 (필수, --force로 대체 불가)
    allowDirty: false,        // --allow-dirty: git 작업트리 dirty 상태에서도 강행
    deleteDevelopBranch: false, // --delete-develop-branch: 로컬 develop 브랜치까지 삭제
    keepVersionYml: false,
    keepReadme: false,
    keepChangelog: false,
    keepWorkflows: false,
    keepScripts: false,
  };
  const args = [...argv];
  const seenFlags = new Set(); // --semver-auto/--copilot류 상호 모순 플래그 검증용
  while (args.length > 0) {
    const a = args.shift();
    const typeFlag = TYPE_CLI_FLAG_BY_NAME.get(a);
    if (typeFlag) { result[typeFlag.field] = typeFlag.parse(args.shift()); continue; }
    switch (a) {
      case "-m": case "--mode":
        result.mode = args.shift() ?? ""; break;
      case "-v": case "--version":
        // npm 관례: -v/--version 은 패키지 버전 출력. (초기 버전 지정은 --project-version)
        result.showVersion = true; break;
      case "--project-version": {
        // 릴리스 워크플로우(version_manager)는 x.y.z만 올릴 수 있다 — 흔한 v 접두사는 떼고 받는다.
        const raw = (args.shift() ?? "").trim();
        const v = raw.replace(/^v/i, "");
        if (!/^\d+\.\d+\.\d+$/.test(v)) {
          throw new CliError(`--project-version 값이 올바르지 않습니다: '${raw}' (x.y.z 형식, 예: 1.0.0)`);
        }
        result.version = v; break;
      }
      case "-t": case "--type": {
        const csv = args.shift() ?? "";
        const seen = new Set();
        const types = [];
        for (let t of csv.split(",")) {
          t = t.replace(/\s/g, "");
          if (t === "") continue;
          if (seen.has(t)) continue;         // dedup
          if (!VALID_TYPES.includes(t)) {
            throw new CliError(`지원하지 않는 타입: '${t}'\n지원 타입: ${VALID_TYPES.join(" ")}`);
          }
          seen.add(t);
          types.push(t);
        }
        if (types.length === 0) throw new CliError("--type 인자가 비어 있습니다");
        result.types = types;
        result.primaryType = types[0];
        break;
      }
      case "--lang": {
        // The language is not resolved yet while parsing, so errors use the default language.
        const supported = SUPPORTED_LANGUAGES.join(", ");
        const raw = args.shift();
        const v = normalizeLanguage(raw);
        if (!v) throw new CliError(t("cli.lang.missing", { supported }, DEFAULT_LANGUAGE));
        if (!isSupportedLanguage(v)) {
          throw new CliError(t("cli.lang.invalid", { value: String(raw).trim(), source: "--lang", supported }, DEFAULT_LANGUAGE));
        }
        result.lang = v; break;
      }
      case "--force": result.force = true; break;
      case "--dry-run": result.dryRun = true; break;
      case "--purge-readme": result.purgeReadme = true; break;
      case "--purge-gitignore": result.purgeGitignore = true; break;
      case "--purge-version": result.purgeVersion = true; break;
      case "--yes": result.yes = true; break;
      case "--allow-dirty": result.allowDirty = true; break;
      case "--delete-develop-branch": result.deleteDevelopBranch = true; break;
      case "--keep-version-yml": result.keepVersionYml = true; break;
      case "--keep-readme": result.keepReadme = true; break;
      case "--keep-changelog": result.keepChangelog = true; break;
      case "--keep-workflows": result.keepWorkflows = true; break;
      case "--keep-scripts": result.keepScripts = true; break;
      case "--deploy-style": {
        const v = args.shift();
        if (!isDeployStyle(v)) {
          throw new CliError(`--deploy-style 값이 올바르지 않습니다: ${v ?? "(없음)"} (${[...DEPLOY_STYLES.map((s) => s.value), NO_DEPLOY_STYLE].join(" | ")})`);
        }
        result.deployStyle = v; break;
      }
      case "--semver-auto":
        if (seenFlags.has("--no-semver-auto")) throw new CliError("--semver-auto와 --no-semver-auto는 동시에 지정할 수 없습니다");
        seenFlags.add("--semver-auto"); result.includeSemverAuto = true; break;
      case "--no-semver-auto":
        if (seenFlags.has("--semver-auto")) throw new CliError("--semver-auto와 --no-semver-auto는 동시에 지정할 수 없습니다");
        seenFlags.add("--no-semver-auto"); result.includeSemverAuto = false; break;
      case "--copilot":
        if (seenFlags.has("--no-copilot")) throw new CliError("--copilot과 --no-copilot은 동시에 지정할 수 없습니다");
        seenFlags.add("--copilot"); result.includeCopilotAi = true; break;
      case "--no-copilot":
        if (seenFlags.has("--copilot")) throw new CliError("--copilot과 --no-copilot은 동시에 지정할 수 없습니다");
        seenFlags.add("--no-copilot"); result.includeCopilotAi = false; break;
      case "--paths": {
        // 값이 없는데 조용히 자동 감지로 넘어가면 사용자가 지정했다고 믿은 경로와 다르게 설치된다.
        const v = (args.shift() ?? "").trim();
        if (!v) throw new CliError("--paths 인자가 비어 있습니다 (예: --paths flutter=app,react=client)");
        result.pathsCsv = v; break;
      }
      case "--main-branch": case "--develop-branch": {
        const v = (args.shift() ?? "").trim();
        if (!v) throw new CliError(`${a}에 빈 값을 지정할 수 없습니다`);
        // 워크플로우 트리거·셸 명령에 그대로 치환되는 값이라 쓸 수 없는 이름은 설치 전에 거부한다.
        if (!isValidBranchName(v)) throw new CliError(`${a} 값이 브랜치 이름으로 올바르지 않습니다: '${v}'`);
        if (a === "--main-branch") result.mainBranch = v; else result.developBranch = v;
        break;
      }
      case "-h": case "--help": result.help = true; break;
      default:
        throw new CliError(`알 수 없는 옵션: ${a}`);
    }
  }
  if (!VALID_MODES.includes(result.mode)) {
    throw new CliError(
      `지원하지 않는 모드: '${result.mode}'\n지원 모드: interactive full uninstall status doctor`
    );
  }
  return result;
}

// "flutter=app,react=client" → Map<type, normalizedPath>. 타입 검증(무효 → throw).
export function parsePathsCsv(csv) {
  const map = new Map();
  if (!csv) return map;
  for (const pair of csv.split(",")) {
    if (pair.trim() === "") continue;
    const eq = pair.indexOf("=");
    const type = (eq >= 0 ? pair.slice(0, eq) : pair).replace(/\s/g, "");
    const rawPath = eq >= 0 ? pair.slice(eq + 1) : "";
    if (!VALID_TYPES.includes(type)) {
      throw new CliError(`--paths에 지원하지 않는 타입: '${type}'`);
    }
    const path = normalizePath(rawPath);
    if (!isRepoRelativePath(path)) {
      throw new CliError(`--paths는 레포 안의 상대경로만 지정할 수 있습니다: '${type}=${rawPath.trim()}'`);
    }
    map.set(type, path);
  }
  return map;
}
