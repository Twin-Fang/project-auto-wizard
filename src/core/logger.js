// 실행 추적 로그 — "무엇을 어떤 순서로 왜 그렇게 했는지"를 시간순으로 남긴다.
//
// 왜 즉시 append인가: 디버깅에서 가장 알고 싶은 순간은 크래시 직전이다. 끝나고 한 번에
// 쓰는 구조는 예외가 나면 아무것도 남기지 못한다(구 install-log.js가 그랬다).
//
// 왜 로컬 전용인가: 상세도를 제약하지 않기 위해서다. 로그 디렉토리에 .gitignore를 직접
// 두어 그 폴더만 추적에서 뺀다 — 루트 .gitignore는 건드리지 않는다(이슈 #7 원칙).
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const LOG_DIR = ".github/.wizard/logs";
const KEEP = 20;              // 유지할 로그 파일 수
const GITIGNORE_BODY = "*\n!.gitignore\n";

// 값에 비밀이 들어갈 수 있는 키 — 현재 질문 항목에는 없지만(도메인·경로·포트·인증 '방식'),
// 앞으로 추가될 때 그냥 평문으로 남지 않도록 처음부터 걸어둔다.
const SECRET_KEY_RE = /(PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL)/i;
const MASK = "***";

let state = null; // { file, clock, startedAt, disabled }

export function maskValue(key, value) {
  // SSH_AUTH_METHOD처럼 "방식"만 담는 키는 비밀이 아니다 — 이름에 KEY가 들어가도 마스킹하지 않는다.
  if (key === "SSH_AUTH_METHOD") return value;
  return SECRET_KEY_RE.test(key) ? MASK : value;
}

// "2026-08-26 12:03:41" → "20260826-120341". 파일명이 곧 정렬 키가 되도록.
export function stampFrom(now = "") {
  const m = String(now).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return "unknown";
  return `${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}${m[6]}`;
}

export function logFilename(now, action = "install") {
  return `${stampFrom(now)}-${action}.log`;
}

// 최근 KEEP개만 남기고 오래된 것부터 지운다. 파일명이 시각 오름차순이라 이름 정렬로 충분하다.
// 새 파일이 곧 하나 추가되므로 KEEP-1개까지 줄인다.
function rotate(dir) {
  const logs = readdirSync(dir).filter((f) => f.endsWith(".log")).sort();
  for (const f of logs.slice(0, Math.max(0, logs.length - (KEEP - 1)))) {
    rmSync(join(dir, f), { force: true });
  }
}

export function initLogger(targetRoot, opts = {}) {
  const { action = "install", now = "", argv = [], templateVersion = "unknown", clock = () => new Date() } = opts;
  try {
    const dir = join(targetRoot, LOG_DIR);
    mkdirSync(dir, { recursive: true });
    // 사용자가 직접 둔 .gitignore가 있으면 존중한다.
    const gi = join(dir, ".gitignore");
    if (!existsSync(gi)) writeFileSync(gi, GITIGNORE_BODY);
    rotate(dir);

    const rel = `${LOG_DIR}/${logFilename(now, action)}`;
    const file = join(targetRoot, rel);
    const header =
      `=== project-auto-wizard v${templateVersion} | ${action} | ${now} ===\n` +
      `argv    : ${["project-auto-wizard", ...argv].join(" ")}\n` +
      `node    : ${process.version} | ${process.platform} ${process.arch}\n` +
      `target  : ${targetRoot}\n\n`;
    writeFileSync(file, header);
    state = { file, clock, startedAt: Date.now(), disabled: false };
    return { path: rel };
  } catch (e) {
    // 로그를 못 남긴 것이 설치를 되돌릴 이유는 아니다 — 다만 조용히 삼키지는 않는다.
    process.stderr.write(`[warn] 실행 로그를 시작하지 못했습니다: ${e.message}\n`);
    state = null;
    return null;
  }
}

export function resetLogger() {
  state = null;
}
