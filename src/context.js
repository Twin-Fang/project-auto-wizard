// 마법사 전역 상태를 하나의 객체로 명시화 (bash 전역 변수군 대체)
export const VALID_TYPES = [
  "spring", "flutter", "next", "react",
  "react-native", "react-native-expo", "node", "python", "basic",
];

// --mode 화이트리스트 (issue #19) — 알 수 없는 값은 부수효과(브랜치 조회 등) 이전에 즉시 거부해야 한다.
// purge는 --help/대화형 메뉴에 노출하지 않는 숨김 모드(issue #6)이지만 검증 대상에는 포함한다.
export const VALID_MODES = [
  "interactive", "full", "version", "workflows",
  "revert", "uninstall", "status", "doctor", "purge",
];

export const DEFAULT_VERSION = "0.0.0"; // 패키지 버전 읽기 실패 시 폴백 (배너용 — breaking 비교엔 안 씀)

export function createContext(overrides = {}) {
  return {
    mode: "interactive",
    force: false,
    types: [],
    version: "",
    branch: "",
    branches: null,          // { main, develop, mode: "pr-flow"|"trunk-based" } — resolveBranchConfig 결과
    paths: new Map(),        // type -> path
    includeNexus: null,      // null=미설정, true/false=명시
    includeSecretBackup: null,
    includeSemverAuto: null, // null=미설정(다운스트림에서 true로 해석), true/false=명시
    templateVersion: "",
    deployValues: new Map(), // "type.KEY" -> value
    counters: {},
    ...overrides,
  };
}
