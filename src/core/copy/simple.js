// 단순 복사 함수 (무조건 덮어쓰기류).
// payload 단일 진실: 스크립트는 payload/scripts/*.py → 사용자 레포 .github/scripts/ 로 설치된다.
// 워크플로우 전부가 이 경로(python3 .github/scripts/*.py)를 호출하므로 누락 시 설치물이 런타임에 죽는다.
import { join } from "node:path";
import { chmodSync } from "node:fs";
import { PATHS, PAYLOAD } from "../paths.js";
import { exists, copyFileSync } from "../fsutil.js";

// version_manager.py, changelog_manager.py 무조건 덮어쓰기 (+chmod — Windows에선 무의미하나 무해).
export function copyScripts(payloadRoot, targetRoot = ".") {
  const scripts = ["version_manager.py", "changelog_manager.py"];
  let copied = 0;
  for (const s of scripts) {
    const src = join(payloadRoot, PAYLOAD.scriptsDir, s);
    if (exists(src)) {
      const dst = join(targetRoot, PATHS.scriptsDir, s);
      copyFileSync(src, dst);
      try { chmodSync(dst, 0o755); } catch { /* Windows 등 chmod 무의미 */ }
      copied++;
    }
  }
  return copied;
}
