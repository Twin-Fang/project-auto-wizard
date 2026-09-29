// 실 파일시스템 프로젝트 감지 (.sh detect_* 실행부 등가).
// detect.js 순수 함수를 fs/git으로 구동한다.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { detectTypesFromMarkers, detectVersionFromFiles, detectBuildNumberFromFiles, detectJdkFromFiles, resolveMarkers } from "./detect.js";
import { parseExisting } from "./version-yml.js";
import { isValidBranchName } from "./branches.js";

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
// paths: --paths로 받은 Map<type,path>. 모노레포는 루트에 마커가 없으므로 사용자가 적은 타입을 쓴다.
// warn: 루트에 마커가 없어 basic으로 떨어질 때 하위 폴더에서 찾은 프로젝트를 알린다.
export function detectTypes(root, { paths = new Map(), warn } = {}) {
  const vy = join(root, "version.yml");
  if (existsSync(vy)) {
    const { types } = parseExisting(readFileSync(vy, "utf8"));
    if (types.length) return types; // basic 포함, 명시돼 있으면 그대로
  }
  const fromRoot = detectTypesFromMarkers({ has: hasFile(root), read: readFile(root) });
  if (paths.size) {
    // --paths 순서가 주 타입을 정한다. 루트 package.json의 node는 다른 타입이 있으면 빼는
    // 마커 스캔 규칙과 맞춘다.
    const merged = [...new Set([...paths.keys(), ...fromRoot])].filter((t) => t !== "basic");
    const types = merged.length > 1 ? merged.filter((t) => t !== "node" || paths.has("node")) : merged;
    return types.length ? types : ["basic"];
  }
  if (fromRoot.length === 1 && fromRoot[0] === "basic" && warn) {
    const found = findSubdirProjects(root);
    if (found.length) {
      const firstDir = new Map();
      for (const { dir, types } of found) for (const t of types) if (!firstDir.has(t)) firstDir.set(t, dir);
      const list = found.map(({ dir, types }) => `${dir}(${types.join(", ")})`).join(", ");
      const hint = [...firstDir].map(([t, d]) => `${t}=${d}`).join(",");
      warn(`⚠️  루트에서 프로젝트 파일을 찾지 못해 basic으로 설치합니다. 하위 폴더에서 발견: ${list}\n` +
        `   모노레포라면 --paths "${hint}"로 다시 실행하세요.`);
    }
  }
  return fromRoot;
}

// 루트 아래 2단계까지 프로젝트 마커가 있는 폴더를 찾는다 (모노레포 안내용).
// 빌드 산출물·의존성·네이티브 폴더는 오탐만 늘리므로 들어가지 않고, 찾은 폴더의 하위도 보지 않는다.
const SUBDIR_PRUNE = new Set(["node_modules", "build", "dist", "android", "ios", "venv", "__pycache__"]);
function findSubdirProjects(root, maxDepth = 2) {
  const found = [];
  const walk = (rel, depth) => {
    let entries;
    try { entries = readdirSync(join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || SUBDIR_PRUNE.has(e.name)) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const dir = join(root, childRel);
      const types = detectTypesFromMarkers({ has: hasFile(dir), read: readFile(dir) });
      if (types[0] !== "basic") found.push({ dir: childRel, types });
      else if (depth + 1 < maxDepth) walk(childRel, depth + 1);
    }
  };
  walk("", 0);
  return found.sort((a, b) => a.dir.localeCompare(b.dir));
}

// 버전 감지 — .sh detect_version 순서. jq는 package.json 파싱에 쓰인 적이 없어 게이트를 제거했다.
// hint: 폴백 경고에 붙일 해결 방법 안내 (대화형/CLI가 다르다).
// 모노레포(--paths)는 버전 파일이 타입 폴더 안에 있다 — 루트만 보면 0.0.1/1로 초기화된다.
// 주 타입 폴더 → 나머지 타입 폴더 → 루트 순으로 찾는다.
function projectBases(types = [], paths = null) {
  const bases = [];
  for (const t of types) {
    const p = paths?.get?.(t);
    if (p && p !== "." && !bases.includes(p)) bases.push(p);
  }
  return bases.length ? [...bases, "."] : ["."];
}

// 첫 번째로 결과가 있는 기준 폴더의 값을 쓴다 — read와 list가 같은 폴더 우선순위를 따른다.
function firstFromBases(bases, fn) {
  return (rel) => {
    for (const b of bases) {
      const c = fn(b === "." ? rel : `${b}/${rel}`);
      if (c != null) return c;
    }
    return null;
  };
}

function readFromProject(root, types = [], paths = null) {
  return firstFromBases(projectBases(types, paths), readFile(root));
}

// 하위 폴더 이름 목록 (React Native의 ios/<앱>/Info.plist 탐색용). 폴더가 없으면 null.
function listFromProject(root, types = [], paths = null) {
  const listDirs = (rel) => {
    try {
      return readdirSync(join(root, rel), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch { return null; }
  };
  return firstFromBases(projectBases(types, paths), listDirs);
}

export function detectVersion(root, { warn = (m) => console.error(m), hint, types = [], paths = null } = {}) {
  const read = readFromProject(root, types, paths);
  const readJson = (rel) => { const c = read(rel); try { return c ? JSON.parse(c) : null; } catch { return null; } };
  const list = listFromProject(root, types, paths);
  const gitTag = gitOut(root, ["describe", "--tags", "--abbrev=0"]);
  return detectVersionFromFiles({ read, readJson, list, gitTag, warn, hint, types });
}

// 타입별 실제 마커 파일 — 감지 로그·설치 로그가 같은 근거 파일을 인용하도록.
export function detectMarkers(root, types = []) {
  return resolveMarkers(types, hasFile(root));
}

// 빌드 JDK 감지 — 배포 워크플로우 JAVA_VERSION 기본값에 실측값을 쓰기 위해.
// base: 모노레포에서 spring 프로젝트 루트 (레포 루트 기준 상대경로).
export function detectJdk(root, base = ".") {
  const rel = base && base !== "." ? (r) => `${base}/${r}` : (r) => r;
  const read = readFile(root);
  return detectJdkFromFiles({ read: (r) => read(rel(r)) });
}

// 빌드 번호 감지 — 신규 통합 시 pubspec.yaml/build.gradle/app.json에서 실제 빌드 번호를 읽는다.
export function detectBuildNumber(root, { types = [], paths = null, warn = (m) => console.error(m) } = {}) {
  const read = readFromProject(root, types, paths);
  const readJson = (rel) => { const c = read(rel); try { return c ? JSON.parse(c) : null; } catch { return null; } };
  return detectBuildNumberFromFiles({ types, read, readJson, warn });
}

// 기본 브랜치 감지 — symbolic-ref → remote show → main.
// 빈 원격(remote add만 하고 push 전)은 remote show가 "HEAD branch: (unknown)"을 돌려준다. 이 값이
// 워크플로우 트리거에 기록되면 릴리스 자동화가 조용히 멈추므로, 유효한 브랜치 이름만 인정하고
// 아니면 로컬 현재 브랜치(첫 push 대상) → main 순으로 폴백하며 경고한다.
// hint: 경고에 붙일 해결 방법 안내 (대화형/CLI가 다르다).
export function detectDefaultBranch(root, { warn = null, hint = "" } = {}) {
  const b = gitOut(root, ["symbolic-ref", "refs/remotes/origin/HEAD"]).replace(/^refs\/remotes\/origin\//, "");
  if (isValidBranchName(b)) return b;
  const show = gitOut(root, ["remote", "show", "origin"]);
  const m = show.match(/HEAD branch:\s*(\S+)/);
  if (m && isValidBranchName(m[1])) return m[1];
  if (!m) return "main"; // origin 없음 — 기존 규칙 그대로
  const local = gitOut(root, ["symbolic-ref", "--short", "HEAD"]);
  const fallback = isValidBranchName(local) ? local : "main";
  warn?.(`⚠️  원격 기본 브랜치를 확인할 수 없어(빈 원격 레포 등) 릴리스 브랜치를 '${fallback}'(으)로 가정합니다.${hint ? ` ${hint}` : ""}`);
  return fallback;
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
// .yaml도 인정한다. Spring은 .yml/.yaml을 모두 공식 지원하는데 종전 정규식이
// .yml만 봐서, application.yaml을 쓰는 프로젝트는 이 값이 빈 문자열이 되고 그 결과
// __APPLICATION_YML_DIR__ 가 치환되지 않은 채 설치됐다.
//
// 같은 디렉토리에서는 프로파일 없는 기본 파일(application.yml/.yaml)을 우선한다. 파일명 정렬만
// 쓰면 'application-dev.yml'이 'application.yml'보다 앞서(`-` < `.`) 프로파일 파일이 잡힌다.
export function findSpringAppYml(root, base = ".") {
  return findSpringConfig(root, base, /^application(-[^/]*)?\.ya?ml$/, /^application\.ya?ml$/);
}

// src/main/resources 아래에서 pattern에 맞는 설정 파일을 찾는다. basePattern(프로파일 없는 기본 파일)이
// 나오면 그걸로 확정한다.
function findSpringConfig(root, base, pattern, basePattern) {
  const startRel = base === "." ? "" : base;
  const PRUNE = new Set(["node_modules", ".git", "build", ".gradle", "target", ".idea"]);
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
      } else if (pattern.test(e.name) && childRel.includes("src/main/resources/")) {
        const isBase = basePattern.test(e.name);
        // 첫 매치는 일단 채택하고, 이후 기본 파일이 나오면 그걸로 승격한다.
        if (!hit || isBase) { hit = childRel; hitIsBase = isBase; }
      }
    }
  };
  walk(startRel, 0);
  return hit;
}

// 배포 워크플로우가 application-prod.yml을 만들 리소스 폴더.
// Spring Initializr 기본 산출물은 application.properties라 yml만 찾으면 빈 값이 되어
// __APPLICATION_YML_DIR__가 치환되지 않은 채 설치된다. yml → properties → 표준 경로 순으로 정한다.
export function findSpringResourcesDir(root, base = ".") {
  const f = findSpringAppYml(root, base)
    || findSpringConfig(root, base, /^application(-[^/]*)?\.properties$/, /^application\.properties$/);
  if (f) return f.split("/").slice(0, -1).join("/");
  return base === "." ? "src/main/resources" : `${base}/src/main/resources`;
}

// 실 resolver 세트 생성 (.sh resolve_token 4종 등가) — index/interactive 공용.
// paths: Map<type, path> (모노레포 경로).
// flutterOptions: resolveFlutterOptions 결과 또는 같은 필드를 가진 context. null이면 Flutter 토큰이
//   빈 값이라 템플릿 기본값(dart-define, store_only)이 그대로 남는다.
export function makeResolvers(root, repoName, paths, flutterOptions = null) {
  const springBase = (t) => paths.get(t || "spring") || paths.get("spring") || ".";
  return {
    repo: () => repoName,
    // 빌드 JDK — 배포 워크플로우 JAVA_VERSION의 기본값. 프로젝트 툴체인을 실측한다.
    // ⚠️ 빈 문자열을 돌려주면 setEnvLine이 그 줄을 건너뛰어 __JAVA_VERSION__이 그대로 남는다
    //    (같은 실패 형태). 감지 실패 시 반드시 종전 기본값 21로 폴백한다.
    jdk: (t) => detectJdk(root, springBase(t)) || "21",
    "spring-app-yml-dir": (t) => findSpringResourcesDir(root, springBase(t)),
    // yml이 없는 프로젝트(properties 전용)는 리소스 폴더의 application.yml로 만든다 —
    // properties 파일 자리에 YAML 내용을 쓰면 설정이 깨진다.
    "spring-app-yml-path": (t) => findSpringAppYml(root, springBase(t))
      || `${findSpringResourcesDir(root, springBase(t))}/application.yml`,
    "flutter-root": () => paths.get("flutter") || ".",
    // CI changes job의 경로 필터 — 타입별 프로젝트 루트. 단일 레포·common은 "."(항상 변경됨으로 판정).
    "project-path": (t) => paths.get(t) || ".",
    // 빈 문자열이면 setEnvLine/setFallbackLine이 줄을 건너뛰어 템플릿 기본값이 남는다.
    "flutter-env-mode": () => flutterOptions?.envMode || "",
    "android-deploy-mode": () => flutterOptions?.androidDeployMode || "",
    "ios-deploy-mode": () => flutterOptions?.iosDeployMode || "",
  };
}
