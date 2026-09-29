// Flutter 진단 항목 — doctor가 타입 훅(doctorChecks)으로 호출한다.
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { PATHS } from "./paths.js";
import { STORE_PLATFORMS, STORE_APP_FILES, parseStoreList, storeAppFilesFor } from "./flutter-options.js";
import { inferInstalledStores } from "./installed-stores.js";

const PLATFORM_ROW_NAME = { android: "Flutter Android 배포 파일", ios: "Flutter iOS 배포 파일" };
const PLACEHOLDER_RE = /__[A-Z][A-Z0-9_]*__/g; // 감지 규칙은 ExportOptions.plist 템플릿·IOS-TESTFLIGHT 검증과 동일
const EXPORT_OPTIONS_REL = STORE_APP_FILES.ios.find((rel) => rel.endsWith("ExportOptions.plist"));

// Flutter 스토어 배포 진단 — 선택한 플랫폼의 필수 파일과 ExportOptions.plist 플레이스홀더.
// 스토어 시크릿 등록 여부는 이번 범위 밖이다. 반환: doctor 결과 행 배열.
export function flutterStoreChecks(cwd, existing, { docs }) {
  const saved = existing.options.flutterStore == null ? null : parseStoreList(existing.options.flutterStore);
  // 저장값 없는 기존 설치는 설치된 스토어 워크플로우로 추론한다 (interactive와 같은 규칙).
  const stores = saved ?? inferInstalledStores(join(cwd, PATHS.workflowsDir));
  const flutterRoot = existing.paths.get("flutter") || ".";
  const rows = [];

  for (const platform of STORE_PLATFORMS.filter((p) => stores.includes(p))) {
    const files = storeAppFilesFor([platform]).map((rel) => posix.join(flutterRoot, rel));
    const missing = files.filter((file) => !existsSync(join(cwd, file)));
    const head = { name: PLATFORM_ROW_NAME[platform], purpose: "fastlane 스토어 업로드에 필요한 파일" };
    rows.push(missing.length
      ? {
        ...head, status: "WARN", value: `없는 파일: ${missing.join(", ")}`,
        impact: ["이 파일이 없으면 스토어 배포 워크플로우가 fastlane 단계에서 실패합니다."],
        actions: ["마법사를 다시 실행하면 없는 파일만 새로 만들어 줍니다 (이미 있는 파일은 덮어쓰지 않음)"],
        doc: docs.flutterStore,
      }
      : { ...head, status: "OK", value: `${files.length}개 있음` });
  }

  const plistPath = posix.join(flutterRoot, EXPORT_OPTIONS_REL);
  if (stores.includes("ios") && existsSync(join(cwd, plistPath))) {
    const head = { name: "ExportOptions.plist", purpose: "iOS 서명·내보내기 설정" };
    const left = [...new Set(readFileSync(join(cwd, plistPath), "utf8").match(PLACEHOLDER_RE) ?? [])];
    rows.push(left.length
      ? {
        ...head, status: "WARN", value: `채워지지 않은 값: ${left.join(", ")}`,
        impact: ["채우지 않으면 IOS-TESTFLIGHT 워크플로우가 ExportOptions.plist 검증 단계에서 중단됩니다."],
        actions: [`${plistPath} 의 플레이스홀더를 실제 값(Team ID · 번들 ID · 프로비저닝 프로파일 이름)으로 바꾸세요`],
        doc: docs.flutterStore,
      }
      : { ...head, status: "OK", value: "플레이스홀더 없음" });
  }
  return rows;
}
