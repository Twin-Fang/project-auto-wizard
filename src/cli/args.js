// CLI 인자 파싱 (.sh top-level while-case 등가) — template_integrator.sh 842~920.
import { VALID_TYPES, VALID_MODES } from "../context.js";
import { DEPLOY_STYLES, isDeployStyle } from "../core/deploy-style.js";

// argv(process.argv.slice(2)) → 파싱 결과. 오류 시 throw(호출부에서 exit 1).
export function parseArgs(argv) {
  const result = {
    mode: "interactive",
    version: "",             // 통합 대상 프로젝트의 초기 버전 (--project-version)
    types: [],
    primaryType: "",
    includeNexus: null,      // null=미설정
    includeSecretBackup: null,
    includeSemverAuto: null,  // --semver-auto / --no-semver-auto (기본 true — 미지정 시 다운스트림에서 해석)
    pathsCsv: "",            // "flutter=app,react=client" 원문 (정규화는 resolve 단계)
    mainBranch: "",          // 릴리스 브랜치 (--main-branch). 빈값=감지된 default branch
    developBranch: "",       // 개발 브랜치 (--develop-branch). 빈값=develop
    deployStyle: "",         // 서버 배포 방식 (--deploy-style). 빈값=version.yml 저장값 → simple
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
  const seenFlags = new Set(); // L7: --nexus류 상호 모순 플래그 검증용
  while (args.length > 0) {
    const a = args.shift();
    switch (a) {
      case "-m": case "--mode":
        result.mode = args.shift() ?? ""; break;
      case "-v": case "--version":
        // npm 관례: -v/--version 은 패키지 버전 출력. (초기 버전 지정은 --project-version)
        result.showVersion = true; break;
      case "--project-version":
        result.version = args.shift() ?? ""; break;
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
          throw new CliError(`--deploy-style 값이 올바르지 않습니다: ${v ?? "(없음)"} (${DEPLOY_STYLES.map((s) => s.value).join(" | ")})`);
        }
        result.deployStyle = v; break;
      }
      case "--nexus":
        if (seenFlags.has("--no-nexus")) throw new CliError("--nexus와 --no-nexus는 동시에 지정할 수 없습니다");
        seenFlags.add("--nexus"); result.includeNexus = true; break;
      case "--no-nexus":
        if (seenFlags.has("--nexus")) throw new CliError("--nexus와 --no-nexus는 동시에 지정할 수 없습니다");
        seenFlags.add("--no-nexus"); result.includeNexus = false; break;
      case "--secret-backup":
        if (seenFlags.has("--no-secret-backup")) throw new CliError("--secret-backup과 --no-secret-backup은 동시에 지정할 수 없습니다");
        seenFlags.add("--secret-backup"); result.includeSecretBackup = true; break;
      case "--no-secret-backup":
        if (seenFlags.has("--secret-backup")) throw new CliError("--secret-backup과 --no-secret-backup은 동시에 지정할 수 없습니다");
        seenFlags.add("--no-secret-backup"); result.includeSecretBackup = false; break;
      case "--semver-auto":
        if (seenFlags.has("--no-semver-auto")) throw new CliError("--semver-auto와 --no-semver-auto는 동시에 지정할 수 없습니다");
        seenFlags.add("--semver-auto"); result.includeSemverAuto = true; break;
      case "--no-semver-auto":
        if (seenFlags.has("--semver-auto")) throw new CliError("--semver-auto와 --no-semver-auto는 동시에 지정할 수 없습니다");
        seenFlags.add("--no-semver-auto"); result.includeSemverAuto = false; break;
      case "--paths": result.pathsCsv = args.shift() ?? ""; break;
      case "--main-branch": {
        const v = args.shift();
        if (!v) throw new CliError("--main-branch에 빈 값을 지정할 수 없습니다");
        result.mainBranch = v; break;
      }
      case "--develop-branch": {
        const v = args.shift();
        if (!v) throw new CliError("--develop-branch에 빈 값을 지정할 수 없습니다");
        result.developBranch = v; break;
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

export class CliError extends Error {}

// 경로 정규화 (.sh resolve_project_paths §3.4): 앞뒤 공백·\→/·끝 /·앞 ./ 제거, 빈값→"."
export function normalizePath(p) {
  let s = String(p).trim();
  s = s.replace(/\\/g, "/");
  s = s.replace(/\/+$/, "");   // 끝 /
  s = s.replace(/^\.\//, "");  // 앞 ./
  return s === "" ? "." : s;
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
    map.set(type, normalizePath(rawPath));
  }
  return map;
}
