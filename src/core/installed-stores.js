// 이미 설치된 스토어 배포 워크플로우 파일명으로 플랫폼을 추론한다 (이슈 #131).
// version.yml에 flutter_store 저장값이 없는 기존 설치가 대상이다 — 저장값이 없다고 "선택 없음"으로 보면
// 잘 쓰던 스토어 워크플로우가 선택 해제 정리 규칙에 의해 삭제된다.
import { existsSync, readdirSync } from "node:fs";
import { STORE_PLATFORMS, STORE_WORKFLOWS } from "./flutter-options.js";

// 반환: 스토어 워크플로우가 하나라도 설치된 플랫폼 (STORE_PLATFORMS 순서).
export function inferInstalledStores(workflowsDir) {
  if (!existsSync(workflowsDir)) return [];
  const installed = new Set(readdirSync(workflowsDir));
  return STORE_PLATFORMS.filter((platform) => STORE_WORKFLOWS[platform].some((file) => installed.has(file)));
}
