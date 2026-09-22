// Flutter 앱 소유 파일(fastlane·ExportOptions.plist) 설치 (이슈 #131).
// 워크플로우와 달리 사용자가 값을 채워 넣는 파일이라 "없을 때만 생성"한다 — 덮어쓰지 않고 baseline
// 3-way도 적용하지 않는다(copyWorkflows의 secret-backup 경로와 같은 선례). 원본 갱신을 기존 사용자에게
// 전파하는 것은 범위 밖이다.
import { join, posix } from "node:path";
import { existsSync } from "node:fs";
import { copyFileSync } from "../fsutil.js";
import { storeAppFilesFor } from "../flutter-options.js";

const FLUTTER_APP_DIR = "flutter-app"; // payload/flutter-app/

// 이번 실행에서 다룰 파일의 (보고용 상대경로, 원본, 목적지) 목록.
// 대상은 Flutter 타입이 있을 때만이고, 선택된 플랫폼(context.flutterStore, null이면 둘 다)의 파일로 한정한다.
function flutterAppTargets(context, payloadRoot, targetRoot) {
  const { types = [], paths = new Map(), flutterStore = null } = context;
  if (!types.includes("flutter")) return [];
  const flutterRoot = paths.get("flutter") || ".";
  return storeAppFilesFor(flutterStore).map((rel) => ({
    reported: posix.join(flutterRoot, rel),
    src: join(payloadRoot, FLUTTER_APP_DIR, rel),
    dst: join(targetRoot, flutterRoot, rel),
  }));
}

// 읽기 전용 — status/dry-run이 쓴다. 원본 payload는 읽지 않는다.
export function planFlutterAppFiles(context, payloadRoot, targetRoot = ".") {
  const result = { created: [], kept: [] };
  for (const { reported, dst } of flutterAppTargets(context, payloadRoot, targetRoot)) {
    (existsSync(dst) ? result.kept : result.created).push(reported);
  }
  return result;
}

export function copyFlutterAppFiles(context, payloadRoot, targetRoot = ".") {
  const result = { created: [], kept: [] };
  for (const { reported, src, dst } of flutterAppTargets(context, payloadRoot, targetRoot)) {
    if (existsSync(dst)) { result.kept.push(reported); continue; }
    copyFileSync(src, dst); // 부모 디렉토리 생성 + 바이트 그대로(CRLF 보존)
    result.created.push(reported);
  }
  return result;
}
