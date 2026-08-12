// 실 파일시스템 프로젝트 감지 (.sh detect_* 실행부 등가).
// SP2-A detect.js 순수 함수를 fs/git으로 구동한다.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { detectTypesFromMarkers, detectVersionFromFiles, detectBuildNumberFromFiles, detectJdkFromFiles, resolveMarkers } from "./detect.js";
import { parseExisting } from "./version-yml.js";

const hasFile = (root) => (rel) => existsSync(join(root, rel));
const readFile = (root) => (rel) => {
  try { return readFileSync(join(root, rel), "utf8"); } catch { return null; }
};

function gitOut(root, args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch { return ""; }
}

// 타입 감지 — version.yml의 project_types 최우선(source of truth), 없으면 마커 스캔.
export function detectTypes(root) {
  const vy = join(root, "version.yml");
  if (existsSync(vy)) {
    const { types } = parseExisting(readFileSync(vy, "utf8"));
    if (types.length) return types; // basic 포함, 명시돼 있으면 그대로
  }
  return detectTypesFromMarkers({ has: hasFile(root), read: readFile(root) });
}

// 버전 감지 — .sh detect_version 순서. jq는 package.json 파싱에 쓰인 적이 없어 게이트를 제거했다(이슈 #22 L4).
// hint: 폴백 경고에 붙일 해결 방법 안내 (대화형/CLI가 다르다 — 이슈 #80).
export function detectVersion(root, { warn = (m) => console.error(m), hint } = {}) {
  const read = readFile(root);
  const readJson = (rel) => { const c = read(rel); try { return c ? JSON.parse(c) : null; } catch { return null; } };
  const gitTag = gitOut(root, ["describe", "--tags", "--abbrev=0"]);
  return detectVersionFromFiles({ read, readJson, gitTag, warn, hint });
}

// 타입별 실제 마커 파일 (이슈 #77) — 감지 로그·설치 로그가 같은 근거 파일을 인용하도록.
export function detectMarkers(root, types = []) {
  return resolveMarkers(types, hasFile(root));
}

// 빌드 JDK 감지 (이슈 #82) — 배포 워크플로우 JAVA_VERSION 기본값에 실측값을 쓰기 위해.
// base: 모노레포에서 spring 프로젝트 루트 (레포 루트 기준 상대경로).
export function detectJdk(root, base = ".") {
  const rel = base && base !== "." ? (r) => `${base}/${r}` : (r) => r;
  const read = readFile(root);
  return detectJdkFromFiles({ read: (r) => read(rel(r)) });
}

// 빌드 번호 감지 — 신규 통합 시 pubspec.yaml/build.gradle/app.json에서 실제 빌드 번호를 읽는다 (이슈 #41).
export function detectBuildNumber(root, { types = [], warn = (m) => console.error(m) } = {}) {
  const read = readFile(root);
  const readJson = (rel) => { const c = read(rel); try { return c ? JSON.parse(c) : null; } catch { return null; } };
  return detectBuildNumberFromFiles({ types, read, readJson, warn });
}

// 기본 브랜치 감지 — symbolic-ref → remote show → main.
export function detectDefaultBranch(root) {
  let b = gitOut(root, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
  if (b) return b.replace(/^refs\/remotes\/origin\//, "");
  const show = gitOut(root, ["remote", "show", "origin"]);
  const m = show.match(/HEAD branch:\s*(\S+)/);
  if (m) return m[1];
  return "main";
}

// 레포명 — git remote get-url origin 마지막 세그먼트, 실패 시 폴더명.
export function detectRepoName(root) {
  const url = gitOut(root, ["remote", "get-url", "origin"]);
  if (url) {
    const seg = url.replace(/\.git$/, "").split(/[/:]/).pop();
    if (seg) return seg;
  }
  return basename(root);
}

// Spring application*.yml 탐색 (.sh resolve_spring_app_yml_dir/path L2767~2780 등가)
// find {base} -path "*/src/main/resources/application*.yml" | head -1 의 fs 재귀 구현.
// 반환: root 기준 상대경로 (예: "server/src/main/resources/application.yml") 또는 "".
//
// .yaml도 인정한다 (이슈 #81). Spring은 .yml/.yaml을 모두 공식 지원하는데 종전 정규식이
// .yml만 봐서, application.yaml을 쓰는 프로젝트는 이 값이 빈 문자열이 되고 그 결과
// __APPLICATION_YML_DIR__ 가 치환되지 않은 채 설치됐다.
//
// 같은 디렉토리에서는 프로파일 없는 기본 파일(application.yml/.yaml)을 우선한다. 파일명 정렬만
// 쓰면 'application-dev.yml'이 'application.yml'보다 앞서(`-` < `.`) 프로파일 파일이 잡힌다.
export function findSpringAppYml(root, base = ".") {
  const startRel = base === "." ? "" : base;
  const PRUNE = new Set(["node_modules", ".git", "build", ".gradle", "target", ".idea"]);
  const APP_YML = /^application(-[^/]*)?\.ya?ml$/;
  let hit = "";
  let hitIsBase = false;
  const walk = (rel, depth) => {
    if (hitIsBase || depth > 8) return; // 기본 파일을 찾았으면 더 볼 필요가 없다
    let entries;
    try { entries = readdirSync(join(root, rel), { withFileTypes: true }); } catch { return; }
    // 정렬로 순회 순서 결정화 (find 순서 플랫폼 편차 제거)
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (hitIsBase) return;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (PRUNE.has(e.name)) continue;
        walk(childRel, depth + 1);
      } else if (APP_YML.test(e.name) && childRel.includes("src/main/resources/")) {
        const isBase = /^application\.ya?ml$/.test(e.name);
        // 첫 매치는 일단 채택하고, 이후 기본 파일이 나오면 그걸로 승격한다.
        if (!hit || isBase) { hit = childRel; hitIsBase = isBase; }
      }
    }
  };
  walk(startRel, 0);
  return hit;
}

// 실 resolver 세트 생성 (.sh resolve_token 4종 등가) — index/interactive 공용.
// paths: Map<type, path> (모노레포 경로).
export function makeResolvers(root, repoName, paths) {
  const springBase = (t) => paths.get(t || "spring") || paths.get("spring") || ".";
  return {
    repo: () => repoName,
    // 빌드 JDK (이슈 #82) — 배포 워크플로우 JAVA_VERSION의 기본값. 프로젝트 툴체인을 실측한다.
    // ⚠️ 빈 문자열을 돌려주면 setEnvLine이 그 줄을 건너뛰어 __JAVA_VERSION__이 그대로 남는다
    //    (이슈 #81과 같은 실패 형태). 감지 실패 시 반드시 종전 기본값 21로 폴백한다.
    jdk: (t) => detectJdk(root, springBase(t)) || "21",
    "spring-app-yml-dir": (t) => {
      const f = findSpringAppYml(root, springBase(t));
      return f ? f.split("/").slice(0, -1).join("/") : "";
    },
    "spring-app-yml-path": (t) => findSpringAppYml(root, springBase(t)) || "",
    "flutter-root": () => paths.get("flutter") || ".",
  };
}
