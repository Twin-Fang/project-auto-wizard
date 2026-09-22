// Flutter 옵션 (이슈 #131) — 환경변수 방식·스토어 배포 대상·배포 모드의 단일 진실.
// 스토어 배포 대상은 deploy-style.js(배포 방식)와 같은 구조 — 값 목록, 파일 필터, 선택 해제 정리 — 를 따른다.
import { join } from "node:path";
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { sha256 } from "./baseline.js";

// 환경변수 주입 방식. dart-define은 --dart-define-from-file, dotenv는 flutter_dotenv/envied용 .env 생성.
// 둘을 동시에 쓰는 both는 만들지 않는다 — 환경변수를 두 곳에서 관리하게 되기 때문.
export const ENV_MODES = ["dart-define", "dotenv"];
export const DEFAULT_ENV_MODE = "dart-define"; // 신규 설치 기본
export const LEGACY_ENV_MODE = "dotenv";       // 기존 설치(version.yml 있음, 저장값 없음)가 조용히 깨지지 않도록 보존

export const STORE_PLATFORMS = ["android", "ios"];
export const DEPLOY_MODES = ["store_only", "store_prepare", "store_submit"];
export const DEFAULT_DEPLOY_MODE = "store_only";
export const NO_STORE = "none";

export const isEnvMode = (v) => ENV_MODES.includes(v);
export const isDeployMode = (v) => DEPLOY_MODES.includes(v);

// "android,ios" | "android" | "none" | "" → 배열. 항상 STORE_PLATFORMS 순서라 직렬화가 결정적이다.
// 알 수 없는 토큰이 하나라도 있거나 문자열이 아니면 null — 호출부가 "값 없음/잘못된 값"으로 처리한다.
export function parseStoreList(csv) {
  if (typeof csv !== "string") return null;
  const tokens = csv.split(",").map((t) => t.trim()).filter((t) => t !== "");
  if (tokens.length === 0 || (tokens.length === 1 && tokens[0] === NO_STORE)) return [];
  if (!tokens.every((t) => STORE_PLATFORMS.includes(t))) return null;
  return STORE_PLATFORMS.filter((p) => tokens.includes(p));
}

// 저장용 직렬화 — 빈 배열은 빈 문자열이 아니라 "none"으로 적어 "선택 안 함"과 "값 없음"을 구분한다.
export function formatStoreList(stores) {
  const ordered = STORE_PLATFORMS.filter((p) => stores.includes(p));
  return ordered.length ? ordered.join(",") : NO_STORE;
}

// 플랫폼별 스토어 워크플로우 (payload/workflows/flutter/ 기준 파일명).
// FIREBASE·SELFHOSTED·TEST-APK·APP-BUILD-TRIGGER·CI는 스토어와 무관해 여기 넣지 않는다 — 항상 설치된다.
export const STORE_WORKFLOWS = {
  android: ["PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml"],
  ios: ["PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml", "PROJECT-FLUTTER-IOS-TEST-TESTFLIGHT.yaml"],
};

export const isStoreWorkflow = (filename) => Object.values(STORE_WORKFLOWS).flat().includes(filename);

// 파일 필터 — stores가 null이면 미결정이라 현행 동작(전부 설치)이다.
// 배열이면 스토어 워크플로우는 선택된 플랫폼 것만 통과하고, 그 외 파일은 항상 통과한다.
export function storeWorkflowFilter(stores) {
  if (stores === null || stores === undefined) return () => true;
  const allowed = new Set(STORE_PLATFORMS.filter((p) => stores.includes(p)).flatMap((p) => STORE_WORKFLOWS[p]));
  return (filename) => !isStoreWorkflow(filename) || allowed.has(filename);
}

// 선택 해제한 스토어 워크플로우 정리 — cleanupOtherDeployWorkflows(deploy-style.js)와 같은 규칙이다.
//   손대지 않은 것(baseline의 installed 해시와 동일) → 삭제
//   손댄 것                                          → .bak으로 옮긴다 (내용 보존, 트리거만 죽인다)
// 사용자 소유인 Fastfile·ExportOptions.plist는 여기서 다루지 않는다 (워크플로우 파일만 대상).
// 반환: { removed:[], backedUp:[] }
export function cleanupDeselectedStoreWorkflows(workflowsDir, installedFilenames, stores, baseline) {
  const keep = storeWorkflowFilter(stores);
  const removed = [];
  const backedUp = [];

  for (const filename of installedFilenames) {
    if (!isStoreWorkflow(filename) || keep(filename)) continue;
    const p = join(workflowsDir, filename);
    if (!existsSync(p)) continue;

    const known = baseline?.files?.[filename]?.installed;
    const untouched = known && sha256(readFileSync(p, "utf8")) === known;
    if (untouched) {
      rmSync(p, { force: true });
      removed.push(filename);
    } else {
      renameSync(p, `${p}.bak`);
      backedUp.push(filename);
    }
  }
  return { removed, backedUp };
}

// 스토어 앱 파일 (payload/flutter-app/ 기준 상대경로) — 플랫폼별 묶음.
export const STORE_APP_FILES = {
  android: ["android/fastlane/Fastfile.playstore"],
  ios: ["ios/fastlane/Fastfile", "ios/ExportOptions.plist"],
};

// 선택된 플랫폼의 앱 파일 목록. stores가 null이면 전부 (현행 동작 = 둘 다 설치).
export function storeAppFilesFor(stores) {
  const platforms = stores === null || stores === undefined
    ? STORE_PLATFORMS
    : STORE_PLATFORMS.filter((p) => stores.includes(p));
  return platforms.flatMap((p) => STORE_APP_FILES[p]);
}
