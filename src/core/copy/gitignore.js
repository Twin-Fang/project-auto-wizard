// .gitignore 보장 — 마법사 자신이 만드는 충돌 백업 부산물(*.bak, *.template.yaml)만 대상으로 한다.
// 마법사가 설치하는 것과 무관한 개인 개발환경 설정(IDE 등)은 마법사 책임 범위 밖 — issue #7.
// 배너 블록은 종료 마커(BANNER_END)로 범위가 명확히 구분되어 있어, 그 안에 사용자가 다른 줄을
// 끼워넣어도 REQUIRED_ENTRIES만 정확히 개별 제거하고 나머지는 보존한다 (issue #20 M7).
// 주의(의도된 트레이드오프): 이 수정 이전 버전으로 설치되어 종료 마커가 없는 배너가 이미 있는
// 레포에서는, 배너 직후 REQUIRED_ENTRIES가 연속으로 이어지는 동안만 제거하는 구 방식으로
// 폴백한다 — issue #7이 "이미 설치된 레포의 .gitignore는 소급 처리하지 않고 사용자 판단에
// 맡긴다"고 명시하므로 별도 마이그레이션 로직을 추가하지 않는다.
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";

// issue #7: 마법사가 설치하는 것과 무관한 개인 개발환경 항목(/.idea 등)은 마법사 책임 밖이므로 제거.
// 대신 마법사 자신의 충돌 처리(workflows.js backup/template 결정)가
// 실제로 만들어내는 부산물만 gitignore 대상으로 삼는다.
const REQUIRED_ENTRIES = ["*.bak", "*.template.yaml"];

// .sh normalize_gitignore_entry: 주석 제거·트림·앞 / 제거·앞 ./ 제거·뒤 / 제거. 빈값이면 원본.
export function normalizeGitignoreEntry(entry) {
  let e = String(entry);
  e = e.replace(/#.*$/, "");        // 주석 제거
  e = e.trim();                      // 앞뒤 공백
  e = e.replace(/^\//, "");         // 앞 /
  e = e.replace(/^\.\//, "");       // 앞 ./
  e = e.replace(/\/$/, "");         // 뒤 /
  return e === "" ? String(entry) : e;
}

function entryExists(target, content) {
  const nt = normalizeGitignoreEntry(target);
  for (const line of content.split("\n")) {
    if (/^\s*#/.test(line)) continue;
    if (/^\s*$/.test(line)) continue;
    if (normalizeGitignoreEntry(line) === nt) return true;
  }
  return false;
}

const NEW_FILE_CONTENT =
  "# project-auto-wizard: 충돌 처리 시 생성되는 백업 파일 (안전하게 무시해도 됩니다)\n" +
  "*.bak\n" +
  "*.template.yaml\n";

// 반환: {created, added:[...]}
export function ensureGitignore(targetRoot = ".") {
  const p = join(targetRoot, ".gitignore");
  if (!existsSync(p)) {
    writeFileSync(p, NEW_FILE_CONTENT);
    return { created: true, added: REQUIRED_ENTRIES.slice() };
  }
  let content = readFileSync(p, "utf8");
  const toAdd = REQUIRED_ENTRIES.filter((e) => !entryExists(e, content));
  if (toAdd.length === 0) return { created: false, added: [] };

  // 파일 끝에 개행 없으면 추가 (.sh: tail -c 1 이 non-empty면 echo "")
  if (content.length > 0 && !content.endsWith("\n")) content += "\n";
  content += "\n";
  content += "# ====================================================================\n";
  content += "# project-auto-wizard: Auto-added entries\n";
  content += "# ====================================================================\n";
  for (const e of toAdd) content += e + "\n";
  content += BANNER_END;
  writeFileSync(p, content);
  return { created: false, added: toAdd };
}

// ensureGitignore가 기존 파일에 배너 블록을 추가할 때 항상 이 정확한 시퀀스로 시작한다
// (빈 줄 하나 + 3줄 배너), 그리고 REQUIRED_ENTRIES 뒤에 BANNER_END로 끝난다. 배너~BANNER_END
// 범위 안에서 REQUIRED_ENTRIES와 일치하는 줄만 개별 제거하고, 사용자가 그 사이/뒤에 추가한
// 줄은 절대 건드리지 않는다 (issue #20 M7).
const BANNER =
  "\n" +
  "# ====================================================================\n" +
  "# project-auto-wizard: Auto-added entries\n" +
  "# ====================================================================\n";

// REQUIRED_ENTRIES 뒤에 오는 종료 마커 — 배너 블록의 "끝"을 명확히 구분해, 그 사이에 사용자가
// 다른 줄을 끼워넣어도 removeAutoAddedEntriesFromGitignore가 정확한 범위 안에서 개별 제거할 수
// 있게 한다 (issue #20 M7). ensureGitignore가 기존 파일에 배너를 추가할 때만 함께 쓴다
// (신규 파일 생성 케이스는 NEW_FILE_CONTENT를 통째로 쓰고 종료 마커는 쓰지 않는다 —
// startsWith 전체 prefix 매칭이라 별도 마커가 필요 없다).
const BANNER_END = "# ==== project-auto-wizard: end of auto-added entries ====\n";

// .gitignore에 마법사가 추가한 항목이 있는지 확인 (체크리스트 노출 판단용).
// 두 케이스: (1) 원래 없던 파일을 통째로(또는 그 뒤에 사용자가 이어 쓴 형태로) 새로 만든 경우
// (2) 기존 파일에 배너 블록을 붙인 경우.
export function hasAutoAddedEntries(targetRoot = ".") {
  const p = join(targetRoot, ".gitignore");
  if (!existsSync(p)) return false;
  const content = readFileSync(p, "utf8");
  return content.startsWith(NEW_FILE_CONTENT) || content.includes(BANNER);
}

// 반환: 'removed' | 'file-deleted' | 'skip-no-gitignore' | 'skip-not-found'
export function removeAutoAddedEntriesFromGitignore(targetRoot = ".") {
  const p = join(targetRoot, ".gitignore");
  if (!existsSync(p)) return "skip-no-gitignore";
  const content = readFileSync(p, "utf8");

  // 원래 파일이 없었는데 마법사가 통째로 만든 경우 — 그 뒤에 사용자가 이어서 추가한 내용만 보존.
  if (content.startsWith(NEW_FILE_CONTENT)) {
    const remainder = content.slice(NEW_FILE_CONTENT.length);
    if (remainder === "") {
      rmSync(p);
      return "file-deleted";
    }
    writeFileSync(p, remainder);
    return "removed";
  }

  // 기존 파일에 배너 블록이 붙은 경우.
  const idx = content.indexOf(BANNER);
  if (idx === -1) return "skip-not-found";
  const afterBanner = idx + BANNER.length;

  // 종료 마커가 있으면(이 수정 이후 설치분) 그 범위 안에서 REQUIRED_ENTRIES만 개별적으로
  // 제거하고, 사용자가 그 사이에 끼워넣은 줄은 순서·연속 여부와 무관하게 그대로 보존한다
  // (issue #20 M7).
  const endIdx = content.indexOf(BANNER_END, afterBanner);
  if (endIdx !== -1) {
    const region = content.slice(afterBanner, endIdx).split("\n");
    const kept = region.filter((line) =>
      !REQUIRED_ENTRIES.some((e) => normalizeGitignoreEntry(line) === normalizeGitignoreEntry(e)));
    const afterEndMarker = content.slice(endIdx + BANNER_END.length);
    writeFileSync(p, content.slice(0, idx) + kept.join("\n") + afterEndMarker);
    return "removed";
  }

  // 종료 마커가 없는 구버전 설치(이 수정 이전) — 배너 직후 REQUIRED_ENTRIES가 연속으로
  // 이어지는 동안만 제거하는 기존 방식으로 폴백한다 (issue #7과 동일한 소급 미처리 원칙).
  const lines = content.slice(afterBanner).split("\n");
  let consumed = 0;
  for (const line of lines) {
    const isKnownEntry = REQUIRED_ENTRIES.some((e) => normalizeGitignoreEntry(line) === normalizeGitignoreEntry(e));
    if (!isKnownEntry) break;
    consumed += line.length + 1; // +1: split이 삼킨 "\n"
  }
  writeFileSync(p, content.slice(0, idx) + content.slice(afterBanner + consumed));
  return "removed";
}
