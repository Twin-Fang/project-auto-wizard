// .gitignore 보장 (.sh ensure_gitignore + normalize/check 등가) — template_integrator.sh 3996~4111.
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";

const REQUIRED_ENTRIES = ["/.idea", "/.claude/settings.local.json"];

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
  "# IDE Settings\n" +
  "/.idea\n" +
  "\n" +
  "# Claude AI Settings\n" +
  "/.claude/settings.local.json\n";

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
  writeFileSync(p, content);
  return { created: false, added: toAdd };
}

// ensureGitignore가 기존 파일에 배너 블록을 추가할 때 항상 이 정확한 시퀀스로 시작한다
// (빈 줄 하나 + 3줄 배너). 배너 직후, REQUIRED_ENTRIES와 일치하는 라인이 연속되는 동안만
// "마법사가 추가한 항목"이다 — 그 뒤에 사용자가 나중에 추가한 항목은 절대 건드리지 않는다.
const BANNER =
  "\n" +
  "# ====================================================================\n" +
  "# project-auto-wizard: Auto-added entries\n" +
  "# ====================================================================\n";

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

  // 기존 파일에 배너 블록이 붙은 경우 — 배너 직후 REQUIRED_ENTRIES와 일치하는 라인이 연속되는
  // 동안만 제거하고, 그 뒤(사용자가 나중에 추가한 항목)는 그대로 둔다.
  const idx = content.indexOf(BANNER);
  if (idx === -1) return "skip-not-found";
  const afterBanner = idx + BANNER.length;
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
