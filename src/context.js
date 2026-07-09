// 마법사 전역 상태를 하나의 객체로 명시화 (bash 전역 변수군 대체)
export const VALID_TYPES = [
  "spring", "flutter", "next", "react",
  "react-native", "react-native-expo", "node", "python", "basic",
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
    includeCodeRabbit: null, // CodeRabbit opt-in (기본 false — version.yml options.coderabbit에 기록)
    templateVersion: "",
    deployValues: new Map(), // "type.KEY" -> value
    counters: {},
    ...overrides,
  };
}
