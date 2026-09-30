import { flutterHooks } from "./flutter-hooks.js";

// 프로젝트 타입 레지스트리 — 타입별 지식(감지 마커, 감지 순서, 버전·빌드 번호 파일)을 한 곳에 둔다.
// 타입 목록·마커 맵·감지 체인은 모두 이 표에서 만들어지므로, 새 타입은 여기에 한 줄을 더하는 것에서 시작한다.
// (릴리스 시점의 버전 파일 쓰기는 payload/scripts/version_manager.py가 따로 담당한다.)
//
// 필드:
//   id                 CLI·version.yml에 쓰이는 타입 이름. 배열 순서가 곧 --help·대화형 선택지 표시 순서다.
//   markers            그 타입의 근거 파일. [0]이 대표 파일이고, 모노레포 경로 탐색은 이 순서로 우선순위를 둔다.
//   detectBy           자동 감지 방식 — "markers": markers 중 하나라도 있으면 감지
//                      "package": package.json 의존성 키(packageDep)로 감지
//                      "package-fallback": package.json은 있지만 위 어느 것도 아닐 때
//                      없음: 자동 감지하지 않는다(basic은 아무것도 감지되지 않았을 때의 결과).
//   detectOrder        같은 detectBy 안에서의 판정 순서. 앞선 규칙이 이긴다(expo 앱은 react-native 의존성도 가짐).
//   versionSources     설치 시 버전을 읽을 파일 키(detect.js의 sources) — 주 타입일 때 이 순서로 먼저 읽는다.
//   buildNumberSource  모바일 빌드 번호를 읽을 파일 키(detect.js의 detectBuildNumberFromFiles).
//   singleServerCd     배포 방식 변형 없이 서버 배포 CD가 하나뿐일 때 그 워크플로우 파일명.
//   hooks              타입 전용 동작. 없는 훅은 "할 일 없음"이라 공통 코드는 hooksFor()로 있는 것만 호출한다.
//     workflowFilter(context)                         타입 루트 워크플로우 파일 필터(filename → bool) 또는 null
//     cleanupWorkflows(dir, installed, context, baseline, opts)
//                                                     선택에서 빠진 워크플로우 정리 → { removed, backedUp }
//     planAppFiles / copyAppFiles(context, payloadRoot, targetRoot)
//                                                     사용자 소유 앱 파일(없을 때만 생성) 계획/복사 → { created, kept }
//     appFilesTag                                     앱 파일 복사 로그의 분류 이름
//     statusLabels(options)                           status 옵션 줄에 덧붙일 문자열
//     doctorChecks(cwd, existing, { docs })           doctor 진단 행 배열
//     resolveOptions({ opts, existing, workflowsDir }) CLI 옵션 → 저장값 → 기본값 순으로 확정한 타입 옵션 객체
//                                                     (workflowsDir는 설치된 워크플로우로 추론할 때만 넘긴다)
//     contextDefaults                                 createContext의 미결정 기본 필드
//     contextFields(options) / optionsFromContext(context)
//                                                     옵션 객체 ↔ 설치 컨텍스트 필드 변환
//     versionOptionsBlock(options)                    version.yml options 아래에 덧붙일 블록(6칸 들여쓰기)
//     savedOptionKeys                                 version.yml 저장 키 → parseExisting 옵션 필드
//     cliFlags[{ flag, field, initial, parse(v) }]    타입 전용 CLI 플래그(파싱 결과 opts[field]에 담긴다)
//     installNotices(options)                         설치 직후 알릴 경고 배열(빈 값은 무시)
//     logChoices(context)                             설치 로그에 남길 선택값 [이름, 값] 배열
// (타입 전용 대화형 질문 흐름은 아직 interactive.js에 남아 있다.)
export const TYPES = [
  {
    id: "spring",
    markers: ["build.gradle", "build.gradle.kts", "pom.xml"],
    detectBy: "markers", detectOrder: 2,
    versionSources: ["gradle", "gradleKts", "pom"],
  },
  {
    id: "flutter",
    markers: ["pubspec.yaml"],
    detectBy: "markers", detectOrder: 1,
    versionSources: ["pubspec"],
    buildNumberSource: "pubspec",
    hooks: flutterHooks,
  },
  {
    id: "next",
    markers: ["package.json"],
    detectBy: "package", packageDep: "next", detectOrder: 3,
    versionSources: ["packageJson"],
    singleServerCd: "PROJECT-NEXT-CICD.yaml",
  },
  {
    id: "react",
    markers: ["package.json"],
    detectBy: "package", packageDep: "react", detectOrder: 4,
    versionSources: ["packageJson"],
    singleServerCd: "PROJECT-REACT-CICD.yaml",
  },
  {
    id: "react-native",
    markers: ["package.json"],
    detectBy: "package", packageDep: "react-native", detectOrder: 2,
    // 릴리스 때 동기화하는 네이티브 파일이 기준이고, 거기서 못 읽을 때만 package.json을 본다.
    versionSources: ["reactNative", "packageJson"],
    buildNumberSource: "androidGradle",
  },
  {
    // Expo는 최신 create-expo-app 템플릿처럼 app.json 없이 app.config.ts/js만 쓸 수 있다.
    // 구성 파일이 아예 없어도 expo 의존성이 있는 package.json이 곧 근거다.
    id: "react-native-expo",
    markers: ["app.json", "app.config.ts", "app.config.js", "package.json"],
    detectBy: "package", packageDep: "expo", detectOrder: 1,
    versionSources: ["appJson", "packageJson"],
    buildNumberSource: "expoAppJson",
  },
  {
    id: "node",
    markers: ["package.json"],
    detectBy: "package-fallback",
    versionSources: ["packageJson"],
  },
  {
    id: "python",
    markers: ["pyproject.toml", "setup.py", "requirements.txt"],
    detectBy: "markers", detectOrder: 3,
    versionSources: ["pyproject", "setupPy"],
  },
  {
    // 마커 파일이 없는 타입 — 아무것도 감지되지 않았을 때의 결과이자 경로가 필요 없는 타입.
    id: "basic",
    markers: [],
  },
  {
    id: "go",
    markers: ["go.mod"],
    detectBy: "markers", detectOrder: 4,
    versionSources: [],
  },
];

// 감지 결과가 하나도 없을 때의 타입
export const FALLBACK_TYPE = "basic";

const BY_ID = new Map(TYPES.map((t) => [t.id, t]));

// 알 수 없는 타입은 undefined — 호출부가 각자의 기본값을 정한다.
export const typeInfo = (id) => BY_ID.get(id);

// types 중 훅 name을 가진 것만 [{ id, hook }]으로 — 주어진 타입 순서를 유지한다.
export function hooksFor(types, name) {
  const found = [];
  for (const id of types) {
    const hook = BY_ID.get(id)?.hooks?.[name];
    if (hook !== undefined) found.push({ id, hook });
  }
  return found;
}

// types 중 훅 name을 가진 타입들의 반환값(객체)을 하나로 합친다 — 옵션·컨텍스트 필드처럼 타입마다 다른 키를 낼 때 쓴다.
export function mergeHookResults(types, name, ...args) {
  return Object.assign({}, ...hooksFor(types, name).map(({ hook }) => hook(...args)));
}

// 모든 타입이 선언한 훅 상수(contextDefaults·savedOptionKeys 등)를 하나로 합친다 — 타입이 정해지기 전에 필요한 기본 형태용.
export const allHookValues = (name) => Object.assign({}, ...TYPES.map((t) => t.hooks?.[name]));

// 표시 순서 그대로의 타입 이름 목록
// VALID_TYPES·ALL_TYPES가 같은 배열을 공유하므로 한쪽에서 바꿔 다른 쪽이 오염되지 않게 고정한다.
export const TYPE_IDS = Object.freeze(TYPES.map((t) => t.id));

const byDetectOrder = (a, b) => a.detectOrder - b.detectOrder;

// 파일 존재만으로 감지하는 타입 (감지 순서대로)
export const MARKER_DETECTED_TYPES = TYPES.filter((t) => t.detectBy === "markers").sort(byDetectOrder);

// package.json 의존성으로 가르는 타입 (판정 순서대로)
export const PACKAGE_DETECTED_TYPES = TYPES.filter((t) => t.detectBy === "package").sort(byDetectOrder);

// package.json이 있지만 알려진 프레임워크 의존성이 없을 때의 타입
export const PACKAGE_FALLBACK_TYPE = TYPES.find((t) => t.detectBy === "package-fallback").id;

// 모바일 빌드 번호(version_code)를 가진 타입
export const BUILD_NUMBER_TYPES = new Set(TYPES.filter((t) => t.buildNumberSource).map((t) => t.id));

// 배포 방식 변형 없이 서버 배포 CD가 하나뿐인 워크플로우 파일명
export const SINGLE_SERVER_CD_FILES = new Set(TYPES.filter((t) => t.singleServerCd).map((t) => t.singleServerCd));
