import {
  typeInfo, FALLBACK_TYPE, MARKER_DETECTED_TYPES, PACKAGE_DETECTED_TYPES, PACKAGE_FALLBACK_TYPE,
} from "./types.js";

// package.json 분류 — 의존성 "키"를 정확히 비교한다. 원문 부분문자열로 보면 export 스크립트나
// exponential-backoff가 expo로, react-native-web을 쓰는 웹앱이 react-native로, keywords의 "next"가
// next로 오감지된다. 입력은 package.json 원문 문자열(raw). 판정 순서는 레지스트리의 detectOrder.
export function classifyPackageText(raw) {
  let pkg;
  try { pkg = JSON.parse(String(raw || "")); } catch { return PACKAGE_FALLBACK_TYPE; }
  if (!pkg || typeof pkg !== "object") return PACKAGE_FALLBACK_TYPE;
  const deps = new Set();
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const d = pkg[field];
    if (d && typeof d === "object") for (const k of Object.keys(d)) deps.add(k);
  }
  return PACKAGE_DETECTED_TYPES.find((t) => deps.has(t.packageDep))?.id ?? PACKAGE_FALLBACK_TYPE;
}

// 편의: 파싱된 객체를 받는 경우 원문으로 재직렬화해 위 규칙 적용
export function classifyPackageJson(pkgOrRaw) {
  const raw = typeof pkgOrRaw === "string" ? pkgOrRaw : JSON.stringify(pkgOrRaw || {});
  return classifyPackageText(raw);
}

// 마커 스캔 (동작명세 §3.1). has(relpath)=>bool 주입. node는 다른 타입 있으면 미추가.
// read(relpath)=>string|null 로 package.json 원문을 받아 classifyPackageText에 넘긴다.
export function detectTypesFromMarkers({ has, read }) {
  const types = [];
  for (const t of MARKER_DETECTED_TYPES) if (t.markers.some(has)) types.push(t.id);
  if (has("package.json")) {
    const cls = classifyPackageText(read ? read("package.json") : "");
    if (cls === PACKAGE_FALLBACK_TYPE) { if (types.length === 0) types.push(cls); }
    else types.push(cls);
  }
  return types.length ? [...new Set(types)] : [FALLBACK_TYPE];
}

// 1.2.3-rc.1·1.2.3+7 같은 prerelease/빌드 메타데이터는 x.y.z 코어만 쓴다.
// version.yml은 x.y.z만 받으므로 감지 실패(0.0.1)로 떨어지는 것보다 코어가 정확하다.
function coreVersion(v) {
  const m = String(v ?? "").trim().match(/^v?(\d+\.\d+\.\d+)(?:[-+][0-9A-Za-z.+-]*)?$/);
  return m ? m[1] : null;
}

// setup.py의 setup(version="x.y.z"). python_version 같은 다른 키는 단어 경계로 거른다.
export function versionFromSetupPy(content) {
  if (!content) return null;
  const m = String(content).match(/(?<![\w.])version\s*=\s*["']([^"']+)["']/);
  return m ? coreVersion(m[1]) : null;
}

// 버전 감지 (동작명세 §3.3) — 순서대로 첫 성공. read(relpath)=>string|null 주입.
// package.json은 이미 Node JSON.parse로 파싱을 마친 값이므로 jq 설치 여부와 무관하게 항상 사용한다.
// hint: 폴백 경고 뒤에 붙일 "그럼 어떻게 고치나" 한 줄. 대화형과 CLI가 서로 다른 방법을
// 안내해야 하므로 호출부가 정한다. 미지정 시 CLI 문구를 쓴다.
// types: 주 타입(첫 항목)의 버전 파일을 먼저 읽는다. 릴리스 때 version_manager가 주 타입
// 파일과 version.yml을 비교하므로, 다른 타입 버전을 잡으면 첫 릴리스에서 버전이 뛴다.
export function detectVersionFromFiles({ read, readJson, gitTag, warn, hint, types = [] }) {
  const grab = (content, re) => {
    for (const line of (content || "").split("\n")) {
      const m = line.match(re);
      if (m) { const v = coreVersion(m[1]); if (v) return v; }
    }
    return null;
  };
  // 줄 시작 앵커가 없으면 ext.kotlin_version 같은 의존성 버전 변수가 먼저 걸린다.
  const gradleRe = /^\s*version\s*=\s*["']?([^"'\s]+)/;
  const sources = {
    packageJson: () => coreVersion(readJson?.("package.json")?.version),
    appJson: () => coreVersion(readJson?.("app.json")?.expo?.version),
    // Groovy DSL과 Kotlin DSL은 같은 문법(`version = "x.y.z"`)이라 정규식을 공유한다.
    // .kts를 빼먹으면 Kotlin DSL Spring 프로젝트가 전부 0.0.1로 초기화된다.
    gradle: () => grab(read("build.gradle"), gradleRe),
    gradleKts: () => grab(read("build.gradle.kts"), gradleRe),
    pom: () => versionFromPom(read("pom.xml")),
    pubspec: () => grab(read("pubspec.yaml"), /^version:\s*(\S+)/),
    pyproject: () => versionFromPyproject(read("pyproject.toml")),
    setupPy: () => versionFromSetupPy(read("setup.py")),
  };
  const order = [
    ...(typeInfo(types[0])?.versionSources || []),
    "packageJson", "gradle", "gradleKts", "pom", "pubspec", "pyproject", "setupPy",
  ];
  for (const key of new Set(order)) {
    const v = sources[key]();
    if (v) return v;
  }
  if (gitTag) { const t = coreVersion(gitTag); if (t) return t; }
  const tail = hint ?? "--project-version으로 직접 지정하거나 version.yml을 확인하세요.";
  warn?.(`⚠️  버전을 자동 감지하지 못해 기본값 0.0.1을 사용합니다 — ${tail}`);
  return "0.0.1";
}

// pyproject.toml의 패키지 버전. [tool.*] 등 다른 섹션의 `version =`은 도구 설정이라
// [project]·[tool.poetry] 섹션 안에서만 읽는다.
export function versionFromPyproject(content) {
  if (!content) return null;
  let section = "";
  for (const line of String(content).split(/\r?\n/)) {
    const h = line.match(/^\s*\[+\s*([^\]]+?)\s*\]+\s*(?:#.*)?$/);
    if (h) { section = h[1]; continue; }
    if (section !== "project" && section !== "tool.poetry") continue;
    const m = line.match(/^\s*version\s*=\s*["']([^"']+)["']/);
    if (m) return coreVersion(m[1]);
  }
  return null;
}

// Maven pom.xml의 프로젝트 버전 — <project> 바로 아래의 <version>만 본다.
// <parent>(스프링 부트 BOM)나 <dependencies> 안의 버전은 프로젝트 버전이 아니므로 깊이로 구분한다.
// 프로젝트 버전이 없으면(부모에서 상속) null — 의존성 버전을 대신 고르지 않는다.
export function versionFromPom(content) {
  if (!content) return null;
  const text = String(content);
  const tokenRe = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<(\/?)([A-Za-z_][\w.:-]*)[^>]*?(\/?)>/g;
  const stack = [];
  let start = -1;
  let m;
  while ((m = tokenRe.exec(text))) {
    const name = m[2];
    if (!name) continue;
    if (m[1]) {
      if (start >= 0 && stack.length === 2 && stack[1] === "version") {
        return coreVersion(text.slice(start, m.index));
      }
      stack.pop();
      continue;
    }
    if (m[3]) continue;
    stack.push(name);
    if (stack.length === 2 && name === "version") start = tokenRe.lastIndex;
  }
  return null;
}

// 타입의 대표 마커 파일. 마커가 없는 타입(basic)·미지 타입은 package.json을 돌려준다.
export function markerForType(type) {
  return typeInfo(type)?.markers[0] || "package.json";
}

// 대표 파일 외의 보조 마커 (예: Spring의 build.gradle.kts·pom.xml).
export function extraMarkers(type) {
  return typeInfo(type)?.markers.slice(1) || [];
}

// 그 타입을 감지하는 데 실제로 쓰인 파일. markerForType은 타입당 대표 파일 하나를
// 고정 반환하므로, build.gradle.kts만 있는 레포에서도 "build.gradle 발견"이라고 출력돼
// 같은 설치 로그 안에서 경로 확정 화면과 파일명이 어긋났다. has()로 실재하는 것을 고른다.
// 실재하는 후보가 없으면(감지 전 화면 등) 대표 파일을 쓴다. 단 "근거"로 보여줄 때는(fallback:false)
// 빈 문자열을 돌려준다 — 직접 고른 타입에 없는 파일을 근거로 붙이면 감지된 것처럼 보인다.
export function resolveMarker(type, has, { fallback = true } = {}) {
  const candidates = [markerForType(type), ...extraMarkers(type)];
  return candidates.find(has) ?? (fallback ? candidates[0] : "");
}

// 빌드 JDK 감지 — 배포 워크플로우의 JAVA_VERSION 기본값이 21로 고정돼 있어
// toolchain이 다른 프로젝트(예: 25)는 그대로 Enter를 누르면 러너 JDK와 어긋나 빌드가 깨진다.
// 빌드 번호를 프로젝트 파일에서 읽는 detectBuildNumberFromFiles와 같은 방식으로 실측한다.
// 반환: "21" 같은 메이저 버전 문자열, 못 찾으면 null.
export function detectJdkFromFiles({ read }) {
  const pick = (content, patterns) => {
    if (!content) return null;
    for (const re of patterns) {
      const m = String(content).match(re);
      // JavaVersion.VERSION_1_8 처럼 1_8 표기는 8로 정규화한다.
      if (m) return m[1] === "1_8" ? "8" : m[1].replace("1_", "");
    }
    return null;
  };
  const gradlePatterns = [
    /JavaLanguageVersion\.of\((\d+)\)/,                  // toolchain (Gradle 권장 표기)
    /JavaVersion\.VERSION_(\d+(?:_\d+)?)/,               // sourceCompatibility = JavaVersion.VERSION_21
    /(?:source|target)Compatibility\s*=?\s*["'](\d+)["']/, // sourceCompatibility = '17'
  ];
  let v;
  if ((v = pick(read("build.gradle.kts"), gradlePatterns))) return v;
  if ((v = pick(read("build.gradle"), gradlePatterns))) return v;
  if ((v = pick(read("pom.xml"), [
    /<java\.version>\s*(\d+(?:\.\d+)?)\s*<\/java\.version>/,
    /<maven\.compiler\.(?:source|release)>\s*(\d+(?:\.\d+)?)\s*<\//,
  ]))) return v.replace(/^1\./, "");
  return null;
}

// 타입별 실제 마커 파일 맵 — 감지 로그·설치 로그가 같은 근거를 쓰도록 한 곳에서 만든다.
export function resolveMarkers(types = [], has) {
  const out = new Map();
  for (const t of types) {
    if (t === "basic") continue;
    // 실제로 있는 파일만 근거로 삼는다 — 없으면 맵에서 빠져 화면·로그가 "직접 선택"으로 다룬다.
    const found = resolveMarker(t, has, { fallback: false });
    if (found) out.set(t, found);
  }
  return out;
}

// 빌드 번호 감지 — 신규 통합 시 pubspec.yaml/build.gradle/app.json에 이미 기록된
// 빌드 번호를 읽어 version_code가 항상 1로 초기화되는 걸 막는다. types 배열에서 먼저 매칭되는
// 첫 타입만 사용한다(다른 감지 로직의 types[0]=primary 관례와 동일). read(rel)=>string|null,
// readJson(rel)=>object|null 로 주입.
export function detectBuildNumberFromFiles({ types = [], read, readJson, warn }) {
  const tryFlutter = () => {
    const content = read("pubspec.yaml");
    if (content == null) return null;
    const m = content.match(/^version:\s*\d+\.\d+\.\d+\+(\d+)/m);
    if (m) return parseInt(m[1], 10);
    warn?.("⚠️  pubspec.yaml에 빌드 번호(+N)가 없어 version_code를 감지하지 못했습니다 — 기본값 1을 사용합니다. 실제 빌드 번호를 확인하세요.");
    return null;
  };
  const tryReactNative = () => {
    const content = read("android/app/build.gradle");
    if (content == null) return null;
    // 앵커 + m 플래그로 한 줄 전체가 "versionCode N"인 라인만 매칭 — 주석 처리된
    // "// versionCode 2"나 다른 블록의 versionCode 참조에 오매칭되지 않도록 함.
    const m = content.match(/^\s*versionCode\s+(\d+)\s*$/m);
    if (m) return parseInt(m[1], 10);
    warn?.("⚠️  android/app/build.gradle에 versionCode가 없어 version_code를 감지하지 못했습니다 — 기본값 1을 사용합니다. 실제 빌드 번호를 확인하세요.");
    return null;
  };
  const tryExpo = () => {
    const data = readJson?.("app.json");
    if (data == null) return null;
    const code = data?.expo?.android?.versionCode;
    if (Number.isInteger(code)) return code;
    warn?.("⚠️  app.json의 expo.android.versionCode가 없어 version_code를 감지하지 못했습니다 — 기본값 1을 사용합니다. 실제 빌드 번호를 확인하세요.");
    return null;
  };
  const readers = { pubspec: tryFlutter, androidGradle: tryReactNative, expoAppJson: tryExpo };
  for (const t of types) {
    const source = typeInfo(t)?.buildNumberSource;
    if (source) return readers[source]();
  }
  return null;
}
