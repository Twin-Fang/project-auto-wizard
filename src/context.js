// 마법사 전역 상태를 하나의 객체로 명시화
import { TYPE_IDS, allHookValues } from "./core/types.js";

// --type 화이트리스트 — 타입 레지스트리(core/types.js)의 표시 순서 그대로.
export const VALID_TYPES = TYPE_IDS;

// --mode 화이트리스트 — 알 수 없는 값은 부수효과(브랜치 조회 등) 이전에 즉시 거부해야 한다.
// purge는 --help/대화형 메뉴에 노출하지 않는 숨김 모드이지만 검증 대상에는 포함한다.
// version/workflows(부분 설치)와 revert는 제거됐다 — 부분 설치는 설치 시점 baseline을
// 반쪽만 갱신해 업데이트 판정을 흐리고, revert는 uninstall의 부분집합이었다.
export const VALID_MODES = [
  "interactive", "full",
  "uninstall", "status", "doctor", "purge",
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
    includeSemverAuto: null, // null=미설정(다운스트림에서 true로 해석), true/false=명시
    includeCopilotAi: null,  // null=미설정(다운스트림에서 false로 해석), true/false=명시 — Copilot AI 요약 opt-in
    // 타입 전용 옵션 필드 — 해당 타입이 없는 프로젝트에서는 전부 무시된다. 필드와 기본값은 타입 훅(contextDefaults)이 정한다.
    ...allHookValues("contextDefaults"),
    templateVersion: "",
    deployValues: new Map(), // "type.KEY" -> value
    counters: {},
    ...overrides,
  };
}
