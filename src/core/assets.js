// payload 자산 해석 — 네트워크 접근 0 (구 acquireTemplate/git clone 대체).
// 마법사가 설치하는 모든 자산은 npm 패키지에 동봉된 payload/ 가 단일 진실이다.
// npx 글로벌 캐시에서 실행돼도 import.meta.url 기준으로 패키지 내 payload를 정확히 가리킨다.
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { exists, readText, listYamlFiles } from "./fsutil.js";
import { DEFAULT_VERSION } from "../context.js";

// 패키지 내 payload/ 절대경로. 테스트·픽스처는 인자 주입으로 대체 가능.
export function resolvePayloadRoot() {
  return fileURLToPath(new URL("../../payload/", import.meta.url));
}

// 마법사(=템플릿) 버전 — 패키지 package.json의 version.
// 구 readTemplateVersion(tempDir/version.yml)과 동일한 소비처(배너·breaking 비교·version.yml 기록)를 채운다.
export function readTemplateVersion() {
  try {
    const pkgPath = fileURLToPath(new URL("../../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return pkg.version || DEFAULT_VERSION;
  } catch {
    return DEFAULT_VERSION;
  }
}

// payload/workflows/common 직하위 yaml 목록 (secret-backup 하위 폴더 제외 — 복사 엔진과 동일 규약).
export function listCommonWorkflows(payloadRoot = resolvePayloadRoot()) {
  return listYamlFiles(join(payloadRoot, "workflows", "common"));
}

// payload 구조 자가 점검 — 필수 폴더 누락 시 명확히 실패 (배포 패키징 오류 조기 발견).
export function assertPayload(payloadRoot = resolvePayloadRoot()) {
  if (!exists(join(payloadRoot, "workflows"))) {
    throw new Error("패키지 구조 오류 — payload/workflows 폴더를 찾지 못했습니다.");
  }
  if (!exists(join(payloadRoot, "scripts"))) {
    throw new Error("패키지 구조 오류 — payload/scripts 폴더를 찾지 못했습니다.");
  }
  return payloadRoot;
}

// payload/version.yml.template 원문 (Task 14 치환 파이프라인 소비).
export function readVersionYmlTemplate(payloadRoot = resolvePayloadRoot()) {
  const p = join(payloadRoot, "version.yml.template");
  return exists(p) ? readText(p) : null;
}
