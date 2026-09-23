// 대화형 마법사의 Flutter 옵션 질문 (이슈 #131) — 환경변수 방식 · 스토어 배포 대상 · 배포 모드.
// 상태는 { envMode, stores, androidDeployMode, iosDeployMode } 불변 객체로 주고받는다.
//   envMode·*DeployMode의 ""와 stores의 null = 미결정 (stores의 빈 배열 = "스토어 배포 안 함"으로 이미 결정됨).
// 이미 결정된 값은 다시 묻지 않는다 (version.yml 저장값 재질문 생략 규약). ESC(취소)는 항상 기본값:
// 처음 묻는 질문이면 기본값, 수정 중이면 현재값을 유지한다.
import {
  isEnvMode, isDeployMode, parseStoreList, STORE_PLATFORMS, DEFAULT_DEPLOY_MODE,
} from "../core/flutter-options.js";
import { deployModeWarning } from "../ui/prompts.js";

export const FLUTTER_EDIT_ITEMS = new Set(["envMode", "flutterStore", "deployMode"]);

const DEPLOY_MODE_KEY = { android: "androidDeployMode", ios: "iosDeployMode" };

// STORE_PLATFORMS 순서로 정렬하고 모르는 값은 버린다 — 플랫폼별 질문 순서를 고정한다.
const normalizeStores = (picked) => STORE_PLATFORMS.filter((platform) => picked.includes(platform));

// 기존 version.yml의 저장값을 상태로 옮긴다. 잘못된 값은 저장이 없는 것으로 보고 다시 묻는다.
export function savedFlutterState(existing) {
  const options = existing?.options ?? {};
  return {
    envMode: isEnvMode(options.envMode) ? options.envMode : "",
    stores: options.flutterStore == null ? null : parseStoreList(options.flutterStore),
    androidDeployMode: isDeployMode(options.androidDeployMode) ? options.androidDeployMode : "",
    iosDeployMode: isDeployMode(options.iosDeployMode) ? options.iosDeployMode : "",
  };
}

async function askDeployMode(io, platform, initialValue) {
  const picked = await io.selectDeployMode({ platform, initialValue });
  const mode = isDeployMode(picked) ? picked : initialValue; // ESC = 기본값
  const warning = deployModeWarning(mode);
  if (warning) io.note?.(warning, "배포 모드");
  return mode;
}

// 고른 플랫폼 중 배포 모드가 아직 없는 것만 묻는다.
async function askUnsetDeployModes(io, state) {
  const next = { ...state };
  for (const platform of state.stores ?? []) {
    const key = DEPLOY_MODE_KEY[platform];
    if (!next[key]) next[key] = await askDeployMode(io, platform, DEFAULT_DEPLOY_MODE);
  }
  return next;
}

// 아직 정해지지 않은 옵션만 묻는다.
//   envModeDefault  — 신규 설치 dart-define / 기존 설치 dotenv (동작 보존)
//   inferredStores  — 저장값 없는 기존 설치가 이미 쓰던 스토어 (신규 설치는 [])
export async function askUnsetFlutterOptions(io, state, { envModeDefault, inferredStores }) {
  const next = { ...state };
  if (!next.envMode) {
    const picked = await io.selectEnvMode({ initialValue: envModeDefault });
    next.envMode = isEnvMode(picked) ? picked : envModeDefault; // ESC = 기본값
  }
  if (next.stores === null) {
    const picked = await io.selectFlutterStores({ initialValues: inferredStores });
    next.stores = Array.isArray(picked) ? normalizeStores(picked) : inferredStores; // ESC = 초기 선택
  }
  return askUnsetDeployModes(io, next);
}

// 수정하기 메뉴에서 고른 항목 하나를 다시 묻는다. 현재값이 초기 선택이고 ESC는 현재값 유지.
export async function editFlutterOption(io, what, state, envModeDefault) {
  if (what === "envMode") {
    const picked = await io.selectEnvMode({ initialValue: state.envMode || envModeDefault });
    return isEnvMode(picked) ? { ...state, envMode: picked } : state;
  }
  if (what === "flutterStore") {
    const picked = await io.selectFlutterStores({ initialValues: state.stores ?? [] });
    if (!Array.isArray(picked)) return state;
    const stores = normalizeStores(picked);
    // 해제된 플랫폼의 배포 모드는 초기화한다 — 그대로 두면 재선택 시 옛 값이 남아 다시 묻지 않는다.
    const reset = { ...state, stores };
    for (const platform of STORE_PLATFORMS) {
      if (!stores.includes(platform)) reset[DEPLOY_MODE_KEY[platform]] = "";
    }
    // 새로 추가되거나 방금 초기화된 플랫폼만 배포 모드를 묻는다 — 이미 정한 플랫폼의 모드는 그대로 둔다.
    return askUnsetDeployModes(io, reset);
  }
  if (what === "deployMode") {
    const stores = state.stores ?? [];
    if (!stores.length) {
      io.note?.("스토어 배포 대상을 먼저 선택하세요 ('스토어 배포 대상' 항목).", "배포 모드");
      return state;
    }
    const next = { ...state };
    for (const platform of stores) {
      const key = DEPLOY_MODE_KEY[platform];
      next[key] = await askDeployMode(io, platform, state[key] || DEFAULT_DEPLOY_MODE);
    }
    return next;
  }
  return state;
}
