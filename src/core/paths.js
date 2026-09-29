// 경로 상수 — 설치 대상(사용자 레포) 경로 + payload 내부 레이아웃.
import { join } from "node:path";

export const PATHS = {
  versionFile: "version.yml",
  workflowsDir: ".github/workflows",
  scriptsDir: ".github/scripts",
};

// payload/ 내부 레이아웃 (payload 단일 진실)
export const PAYLOAD = {
  workflowsDir: "workflows",   // payload/workflows/{common,spring,flutter,...}
  scriptsDir: "scripts",       // payload/scripts/*.py
  configDir: "config",         // payload/config/wizard-prompts.yml 등 (마법사 런타임용)
};

// 타입 하나의 워크플로우 원본 폴더 [타입 직하위, server-deploy 하위] — 존재 여부는 호출부가 확인한다.
// 설치·충돌 조사·미리보기·배포 방식 판정이 같은 폴더 구성을 봐야 결과가 서로 어긋나지 않는다.
export function typeWorkflowDirs(payloadRoot, type) {
  const typeDir = join(payloadRoot, PAYLOAD.workflowsDir, type);
  return [typeDir, join(typeDir, "server-deploy")];
}

export const WORKFLOW_PREFIX = "PROJECT";
export const WORKFLOW_COMMON_PREFIX = "PROJECT-COMMON";

// 경로 정규화 (.sh resolve_project_paths §3.4): 앞뒤 공백·\→/·끝 /·앞 ./ 제거, 빈값→"."
export function normalizePath(p) {
  let s = String(p).trim();
  s = s.replace(/\\/g, "/");
  s = s.replace(/\/+$/, "");   // 끝 /
  s = s.replace(/^\.\//, "");  // 앞 ./
  return s === "" ? "." : s;
}

// 정규화된 경로가 레포 안(상대경로, '..' 없음)인가. 레포 밖을 가리키면 설치 파일(fastlane 등)이
// 옆 레포에 만들어지고 워크플로우 paths 필터도 동작하지 않는다.
export function isRepoRelativePath(p) {
  if (/^\//.test(p) || /^[A-Za-z]:/.test(p)) return false;
  return !p.split("/").includes("..");
}
