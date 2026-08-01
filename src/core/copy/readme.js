// README 버전 섹션 추가 (.sh add_version_section_to_readme 등가) — template_integrator.sh 2145~2181.
import { join } from "node:path";
import { existsSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";

const MARKER = "<!-- AUTO-VERSION-SECTION";
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

// addVersionSectionToReadme가 항상 파일 맨 끝에 붙이는 접두/접미 시퀀스.
// 접두(SECTION_PREFIX)가 있으면 마법사가 append한 "블록"이다 — 이 블록은 항상 SECTION_TAIL
// 라인으로 끝나므로, 그 지점까지만 잘라내야 그 뒤에 사용자가 나중에 덧붙인 내용(라이선스 절 등)을
// 지우지 않는다("파일 끝까지" 자르면 사용자 콘텐츠가 소실된다).
const SECTION_PREFIX = "\n---\n\n" + MARKER;
const SECTION_TAIL = "[전체 버전 기록 보기](CHANGELOG.md)\n";
// PROJECT-COMMON-README-VERSION-UPDATE.yaml(설치되는 CI)은 설치 시점에 이미 사용자가 자기 버전
// 라인을 갖고 있던 README(addVersionSectionToReadme가 'skip-version-line'으로 건너뛴 경우)에는
// '---' 구분자 없이 마커 주석 한 줄만 그 버전 라인 위에 끼워넣는다. 이 경우 버전 라인 자체는
// 사용자 소유이므로 지우지 않고 마커 주석 한 줄만 제거한다.
const MARKER_LINE = "<!-- AUTO-VERSION-SECTION: DO NOT EDIT MANUALLY -->\n";

// README.md에 마법사(또는 설치된 CI)가 추가한 흔적이 있는지 확인 (체크리스트 노출 판단용).
export function hasVersionSection(targetRoot = ".") {
  const p = join(targetRoot, "README.md");
  if (!existsSync(p)) return false;
  const content = readFileSync(p, "utf8");
  return content.includes(SECTION_PREFIX) || content.includes(MARKER_LINE);
}

// 반환: 'removed' | 'skip-no-readme' | 'skip-no-marker' | 'skip-unexpected-format'
export function removeVersionSectionFromReadme(targetRoot = ".") {
  const p = join(targetRoot, "README.md");
  if (!existsSync(p)) return "skip-no-readme";
  const content = readFileSync(p, "utf8");

  const idx = content.indexOf(SECTION_PREFIX);
  if (idx !== -1) {
    // 마법사가 append한 전체 블록 케이스 — SECTION_TAIL 라인까지만 잘라내고 그 이후는 보존한다.
    // tail을 못 찾거나(사용자가 그 줄을 지웠다면), 위저드 블록치고 너무 먼 곳에서 발견되면
    // (사용자가 같은 문구를 자기 문서 어딘가로 옮겨 적은 경우) 그 사이 사용자 콘텐츠까지
    // 지워버릴 수 있으므로 어디까지가 "마법사 구간"인지 확신할 수 없어 안전하게 포기한다.
    // 위저드 블록은 버전 문자열이 길어져도 수백 바이트를 넘지 않는다.
    const MAX_SECTION_LENGTH = 300;
    const tailIdx = content.indexOf(SECTION_TAIL, idx);
    if (tailIdx === -1 || tailIdx > idx + MAX_SECTION_LENGTH) return "skip-unexpected-format";
    const cutEnd = tailIdx + SECTION_TAIL.length;
    writeFileSync(p, content.slice(0, idx) + content.slice(cutEnd));
    return "removed";
  }

  const markerIdx = content.indexOf(MARKER_LINE);
  if (markerIdx !== -1) {
    // CI가 사용자의 기존 버전 라인 위에 마커만 끼워넣은 케이스 — 버전 라인은 건드리지 않는다.
    writeFileSync(p, content.slice(0, markerIdx) + content.slice(markerIdx + MARKER_LINE.length));
    return "removed";
  }

  return "skip-no-marker";
}
