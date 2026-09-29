// 단순 복사 함수 (무조건 덮어쓰기류).
// payload 단일 진실: 스크립트는 payload/scripts/*.py → 사용자 레포 .github/scripts/ 로 설치된다.
// 워크플로우 전부가 이 경로(python3 .github/scripts/*.py)를 호출하므로 누락 시 설치물이 런타임에 죽는다.
import { join } from "node:path";
import { chmodSync, readFileSync } from "node:fs";
import { PATHS, PAYLOAD } from "../paths.js";
import { exists, copyFileSync } from "../fsutil.js";

export const SCRIPT_NAMES = ["version_manager.py", "changelog_manager.py", "truncate_release_notes.py", "issue_helper.py"];

// 파일별로 무엇이 일어날지 계산한다(아무것도 쓰지 않음) — 실제 복사와 --dry-run이 같은 판정을 쓴다.
// 반환: [{ name, action: "create" | "overwrite" | "unchanged" }]
export function planScripts(payloadRoot, targetRoot = ".") {
  const out = [];
  for (const name of SCRIPT_NAMES) {
    const src = join(payloadRoot, PAYLOAD.scriptsDir, name);
    if (!exists(src)) continue;
    const dst = join(targetRoot, PATHS.scriptsDir, name);
    const action = !exists(dst) ? "create"
      : readFileSync(dst).equals(readFileSync(src)) ? "unchanged" : "overwrite";
    out.push({ name, action });
  }
  return out;
}

// 스크립트는 항상 payload 버전으로 덮어쓴다 (+chmod — Windows에선 무의미하나 무해).
// 사용자가 고친 스크립트도 덮이므로, 호출부가 로그에 남길 수 있게 파일별 결과를 돌려준다.
export function copyScripts(payloadRoot, targetRoot = ".") {
  const results = planScripts(payloadRoot, targetRoot);
  for (const { name } of results) {
    const dst = join(targetRoot, PATHS.scriptsDir, name);
    copyFileSync(join(payloadRoot, PAYLOAD.scriptsDir, name), dst);
    try { chmodSync(dst, 0o755); } catch { /* Windows 등 chmod 무의미 */ }
  }
  return results;
}
