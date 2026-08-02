// README 버전 섹션 추가 (.sh add_version_section_to_readme 등가) — template_integrator.sh 2145~2181.
import { join } from "node:path";
import { existsSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";

export const MARKER = "<!-- AUTO-VERSION-SECTION";
// ## (최신 버전|최신버전|Version|버전) : vX.Y.Z (대소문자 무시)
const VERSION_LINE_RE = /##\s*(최신\s*버전|최신버전|Version|버전)\s*:\s*v[0-9]+\.[0-9]+\.[0-9]+/i;

// README.md 없으면 스킵. 마커 또는 버전 라인 있으면 스킵. 없으면 파일 끝에 append.
// 반환: 'skip-no-readme' | 'skip-marker' | 'skip-version-line' | 'added'
export function addVersionSectionToReadme(version, targetRoot = ".") {
  const p = join(targetRoot, "README.md");
  if (!existsSync(p)) return "skip-no-readme";
  const content = readFileSync(p, "utf8");
  if (content.includes(MARKER)) return "skip-marker";
  if (VERSION_LINE_RE.test(content)) return "skip-version-line";

  // .sh: cat >> README.md << EOF — EOF 다음 첫 줄이 빈 줄이므로 append 본문은 "\n---\n..."로 시작.
  // (원본 파일이 개행으로 끝난다는 전제는 .sh와 동일 — heredoc은 원본 끝에 그대로 붙는다.)
  const section =
    "\n" +
    "---\n" +
    "\n" +
    "<!-- AUTO-VERSION-SECTION: DO NOT EDIT MANUALLY -->\n" +
    `## 최신 버전 : v${version}\n` +
    "\n" +
    "[전체 버전 기록 보기](CHANGELOG.md)\n";
  appendFileSync(p, section);
  return "added";
}

// removeVersionSectionFromReadme 전용 — PROJECT-COMMON-README-VERSION-UPDATE.yaml의 VERSION_PATTERNS
// 전체와 정렬한다. VERSION_LINE_RE(=addVersionSectionToReadme의 skip 판정용)보다 넓다: 그 워크플로우는
// 버전 라인이 아예 없던 README에 "## Latest Version : vX.Y.Z"를 직접 삽입하기도 하는데,
// VERSION_LINE_RE는 이를 인식하지 못해 마커만 지우고 버전 라인을 남긴 채로 "removed"를
// 거짓 반환하는 문제가 있었다 (M-N1, Fable 2차 검토).
const REMOVE_VERSION_LINE_RE = /##\s*(최신\s*버전|최신버전|[Cc]urrent\s*[Vv]ersion|[Rr]ecent\s*[Vv]ersion|[Ll]atest\s*[Vv]ersion|Version|버전)\s*:\s*v[0-9]+\.[0-9]+\.[0-9]+/i;

// README AUTO-VERSION-SECTION 블록 제거 (addVersionSectionToReadme와 대칭, purge 모드용).
// 마커는 항상 파일 끝에 있는 게 아니다 — PROJECT-COMMON-README-VERSION-UPDATE.yaml 워크플로우가
// "사용자가 이미 버전 라인을 써 둔 레포"에서는 "---" 프리앰블·CHANGELOG 링크 없이 마커만
// 그 버전 라인 바로 위에 삽입해 두기도 한다. 그래서 "마커~EOF"를 통째로 자르지 않고,
// 마커 라인 + 그 직후 버전 라인(REMOVE_VERSION_LINE_RE 매칭)만 최소 단위로 제거하되,
// addVersionSectionToReadme가 만든 정확한 "\n---\n\n<마커>...\n\n[CHANGELOG 링크]\n" 형태일 때만
// 앞뒤의 "---" 프리앰블·CHANGELOG 링크 라인까지 함께 정리해 바이트 단위로 원본을 복원한다.
// 마커 없으면 no-op. README.md 없으면 no-op.
// 반환: 'removed' | 'skip-no-readme' | 'skip-no-marker'
export function removeVersionSectionFromReadme(targetRoot = ".") {
  const p = join(targetRoot, "README.md");
  if (!existsSync(p)) return "skip-no-readme";
  const lines = readFileSync(p, "utf8").split("\n");
  const markerIdx = lines.findIndex((l) => l.includes(MARKER));
  if (markerIdx === -1) return "skip-no-marker";

  let start = markerIdx;
  let end = markerIdx + 1; // 삭제 구간 [start, end) — 절반열림 구간

  // 마커 바로 다음 줄이 버전 라인이면 함께 제거 (설치 직후·릴리스 갱신 후 두 형태 모두 이 인접 관계를 보장한다).
  if (end < lines.length && REMOVE_VERSION_LINE_RE.test(lines[end])) end += 1;

  // addVersionSectionToReadme()가 만든 전체 블록("\n---\n\n<마커>...") 형태라면
  // 앞의 "---"·그 앞뒤 경계 빈 줄까지 함께 제거해야 원본과 바이트 단위로 복원된다.
  if (start >= 2 && lines[start - 1] === "" && lines[start - 2] === "---") {
    start -= 2;
    if (start >= 1 && lines[start - 1] === "") start -= 1;
  }

  // 블록 끝에 "빈 줄 + CHANGELOG 링크 라인"이 이어지면 함께 제거 (역시 전체 블록 형태에서만 발생).
  if (end < lines.length && lines[end] === "" &&
      end + 1 < lines.length && lines[end + 1].startsWith("[전체 버전 기록 보기]")) {
    end += 2;
  }

  lines.splice(start, end - start);
  writeFileSync(p, lines.join("\n"));
  return "removed";
}
