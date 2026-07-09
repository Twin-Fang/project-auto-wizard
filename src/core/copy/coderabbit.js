// .coderabbit.yaml 복사 (.sh copy_coderabbit_config 등가, force 경로).
// 소스는 payload/coderabbit.yaml (npm 패키징 안전을 위해 무점 파일명으로 동봉 → 대상엔 .coderabbit.yaml).
// Task 15에서 coderabbit opt-in true일 때만 호출하도록 재배선 예정.
import { join } from "node:path";
import { exists, copyFileSync } from "../fsutil.js";

// 반환: 'skip-no-src' | 'copied-new' | 'overwritten-backup' | 'skip-non-tty'
// opts: { force, tty }
export function copyCoderabbit(payloadRoot, { force = false, tty = false } = {}, targetRoot = ".") {
  const src = join(payloadRoot, "coderabbit.yaml");
  if (!exists(src)) return "skip-no-src";
  const dst = join(targetRoot, ".coderabbit.yaml");

  if (exists(dst)) {
    if (force) {
      copyFileSync(dst, dst + ".bak"); // 백업 후 덮어쓰기
      copyFileSync(src, dst);
      return "overwritten-backup";
    }
    if (!tty) return "skip-non-tty"; // 비TTY & !force → 유지
    // 대화형 메뉴는 SP2-C — 여기서는 force가 아니면 유지
    return "skip-non-tty";
  }
  copyFileSync(src, dst); // 신규
  return "copied-new";
}
