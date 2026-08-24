// package.json 내용 분류 (.sh classify_package_json 등가) — 원본 파일 텍스트에 대한
// grep 부분문자열 매칭. dependencies 파싱이 아니라 raw 텍스트 검사여야 등가.
// 입력은 package.json의 원문 문자열(raw). 순서 중요.
export function classifyPackageText(raw) {
  const s = String(raw || "");
  if (s.includes("@react-native") || s.includes("react-native")) {
    return s.includes("expo") ? "react-native-expo" : "react-native";
  }
  if (s.includes('"next"')) return "next";
  if (s.includes('"react"')) return "react";
  return "node";
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
  if (has("pubspec.yaml")) types.push("flutter");
  if (has("build.gradle") || has("build.gradle.kts") || has("pom.xml")) types.push("spring");
  if (has("pyproject.toml") || has("setup.py") || has("requirements.txt")) types.push("python");
  if (has("go.mod")) types.push("go");
  if (has("package.json")) {
    const cls = classifyPackageText(read ? read("package.json") : "");
    if (cls === "node") { if (types.length === 0) types.push("node"); }
    else types.push(cls);
  }
  return types.length ? [...new Set(types)] : ["basic"];
}

const VERSION_RE = /^\d+\.\d+\.\d+$/;

// 버전 감지 (동작명세 §3.3) — 순서대로 첫 성공. read(relpath)=>string|null 주입.
// package.json은 이미 Node JSON.parse로 파싱을 마친 값이므로 jq 설치 여부와 무관하게 항상 사용한다(이슈 #22 L4).
// hint: 폴백 경고 뒤에 붙일 "그럼 어떻게 고치나" 한 줄. 대화형과 CLI가 서로 다른 방법을
// 안내해야 하므로(이슈 #80) 호출부가 정한다. 미지정 시 CLI 문구를 쓴다.
export function detectVersionFromFiles({ read, readJson, gitTag, warn, hint }) {
  const pkg = readJson?.("package.json");
  if (pkg?.version && VERSION_RE.test(pkg.version)) return pkg.version;
  const grab = (content, re) => {
    for (const line of (content || "").split("\n")) {
      const m = line.match(re);
      if (m && VERSION_RE.test(m[1])) return m[1];
    }
    return null;
  };
  let v;
  const gradleRe = /version\s*=\s*["']?(\d+\.\d+\.\d+)/;
  // Groovy DSL과 Kotlin DSL은 같은 문법(`version = "x.y.z"`)이라 정규식을 공유한다.
  // .kts를 빼먹으면 Kotlin DSL Spring 프로젝트가 전부 0.0.1로 초기화된다 (이슈 #77).
  if ((v = grab(read("build.gradle"), gradleRe))) return v;
  if ((v = grab(read("build.gradle.kts"), gradleRe))) return v;
  if ((v = versionFromPom(read("pom.xml")))) return v;
  if ((v = grab(read("pubspec.yaml"), /^version:\s*(\d+\.\d+\.\d+)/))) return v;
  if ((v = grab(read("pyproject.toml"), /version\s*=\s*["']?(\d+\.\d+\.\d+)/))) return v;
  if (gitTag) { const t = String(gitTag).replace(/^v/, ""); if (VERSION_RE.test(t)) return t; }
  const tail = hint ?? "--project-version으로 직접 지정하거나 version.yml을 확인하세요.";
  warn?.(`⚠️  버전을 자동 감지하지 못해 기본값 0.0.1을 사용합니다 — ${tail}`);
  return "0.0.1";
}

// Maven pom.xml의 프로젝트 버전 (이슈 #77). <parent> 블록 안의 버전은 스프링 부트 BOM 버전이라
// 프로젝트 버전이 아니다 — 그 구간을 지운 뒤 첫 <version>을 읽는다.
export function versionFromPom(content) {
  if (!content) return null;
  const body = String(content).replace(/<parent>[\s\S]*?<\/parent>/g, "");
  const m = body.match(/<version>\s*(\d+\.\d+\.\d+)[^<]*<\/version>/);
  return m ? m[1] : null;
}

export function markerForType(type) {
  return { flutter: "pubspec.yaml", "react-native-expo": "app.json", python: "pyproject.toml", spring: "build.gradle", go: "go.mod" }[type] || "package.json";
}

export function extraMarkers(type) {
  return { python: ["setup.py", "requirements.txt"], spring: ["build.gradle.kts", "pom.xml"] }[type] || [];
}

// 그 타입을 감지하는 데 실제로 쓰인 파일 (이슈 #77). markerForType은 타입당 대표 파일 하나를
// 고정 반환하므로, build.gradle.kts만 있는 레포에서도 "build.gradle 발견"이라고 출력돼
// 같은 설치 로그 안에서 경로 확정 화면과 파일명이 어긋났다. has()로 실재하는 것을 고른다.
// 실재하는 후보가 없으면(감지 전 화면 등) 대표 파일을 쓴다.
export function resolveMarker(type, has) {
  const candidates = [markerForType(type), ...extraMarkers(type)];
  return candidates.find(has) ?? candidates[0];
}

// 빌드 JDK 감지 (이슈 #82) — 배포 워크플로우의 JAVA_VERSION 기본값이 21로 고정돼 있어
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
    out.set(t, resolveMarker(t, has));
  }
  return out;
}

// 빌드 번호 감지 (이슈 #41) — 신규 통합 시 pubspec.yaml/build.gradle/app.json에 이미 기록된
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
  for (const t of types) {
    if (t === "flutter") return tryFlutter();
    if (t === "react-native") return tryReactNative();
    if (t === "react-native-expo") return tryExpo();
  }
  return null;
}
