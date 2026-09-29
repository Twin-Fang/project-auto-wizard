// 실행 추적 로그 — "무엇을 어떤 순서로 왜 그렇게 했는지"를 시간순으로 남긴다.
//
// 왜 즉시 append인가: 디버깅에서 가장 알고 싶은 순간은 크래시 직전이다. 끝나고 한 번에
// 쓰는 구조는 예외가 나면 아무것도 남기지 못한다(구 install-log.js가 그랬다).
//
// 왜 로컬 전용인가: 상세도를 제약하지 않기 위해서다. 로그 디렉토리에 .gitignore를 직접
// 두어 그 폴더만 추적에서 뺀다 — 루트 .gitignore는 건드리지 않는다.
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const LOG_DIR = ".github/.wizard/logs";
const KEEP = 20;              // 유지할 로그 파일 수
const GITIGNORE_BODY = "*\n!.gitignore\n";

// 값에 비밀이 들어갈 수 있는 키 — 현재 질문 항목에는 없지만(도메인·경로·포트·인증 '방식'),
// 앞으로 추가될 때 그냥 평문으로 남지 않도록 처음부터 걸어둔다.
const SECRET_KEY_RE = /(PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL)/i;
const MASK = "***";

let state = null; // { targetRoot, name, header, file, rel, clock, startedAt, disabled }

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

// 초 단위 이름만 쓰면 같은 초에 연달아 실행할 때 앞 실행의 로그를 덮어쓴다 — 밀리초를 붙인다.
// 밀리초도 시각 순서라 이름 정렬이 곧 실행 순서라는 전제(rotate)는 그대로 유지된다.
export function logFilename(now, action = "install", ms = 0) {
  return `${stampFrom(now)}-${String(ms).padStart(3, "0")}-${action}.log`;
}

// 같은 이름이 이미 있으면(다른 프로세스가 같은 밀리초에 연 경우) -2, -3을 붙여 새로 만든다.
// wx 플래그로 "없을 때만 생성"을 원자적으로 판정해 동시 실행끼리도 서로 덮어쓰지 않는다.
function createUnique(dir, base, header) {
  const stem = base.replace(/\.log$/, "");
  for (let n = 1; n < 100; n++) {
    const name = n === 1 ? base : `${stem}-${n}.log`;
    try {
      writeFileSync(join(dir, name), header, { flag: "wx" });
      return name;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
  }
  throw new Error(`로그 파일 이름이 모두 사용 중입니다: ${base}`);
}

// 최근 KEEP개만 남기고 오래된 것부터 지운다. 파일명이 시각 오름차순이라 이름 정렬로 충분하다.
// 새 파일이 곧 하나 추가되므로 KEEP-1개까지 줄인다.
function rotate(dir) {
  const logs = readdirSync(dir).filter((f) => f.endsWith(".log")).sort();
  for (const f of logs.slice(0, Math.max(0, logs.length - (KEEP - 1)))) {
    rmSync(join(dir, f), { force: true });
  }
}

// 파일은 첫 기록 때 만든다 — 읽기 전용 모드(status/doctor)나 인자 검증에서 거부된 실행처럼
// 아무것도 바꾸지 않은 실행이 대상 레포에 로그 폴더와 헤더만 있는 파일을 남기지 않도록.
export function initLogger(targetRoot, opts = {}) {
  const { action = "install", now = "", argv = [], templateVersion = "unknown", clock = () => new Date(),
    ms = new Date().getUTCMilliseconds() } = opts;
  // 시각은 UTC다 — 로컬 시간대로 읽으면 몇 시간 어긋나 보이므로 헤더에 밝혀 둔다.
  const header =
    `=== project-auto-wizard v${templateVersion} | ${action} | ${now} UTC ===\n` +
    `argv    : ${["project-auto-wizard", ...argv].join(" ")}\n` +
    `node    : ${process.version} | ${process.platform} ${process.arch}\n` +
    `target  : ${targetRoot}\n\n`;
  const st = { targetRoot, name: logFilename(now, action, ms), header, file: "", rel: "", clock, startedAt: Date.now(), disabled: false };
  state = st;
  return { get path() { return st.rel; } };
}

// 첫 기록 직전에 로그 파일을 연다. 실패하면 이후 기록을 끈다.
function open(st) {
  try {
    const dir = join(st.targetRoot, LOG_DIR);
    mkdirSync(dir, { recursive: true });
    // 사용자가 직접 둔 .gitignore가 있으면 존중한다.
    const gi = join(dir, ".gitignore");
    if (!existsSync(gi)) writeFileSync(gi, GITIGNORE_BODY);
    rotate(dir);
    st.rel = `${LOG_DIR}/${createUnique(dir, st.name, st.header)}`;
    st.file = join(st.targetRoot, st.rel);
    return true;
  } catch (e) {
    // 로그를 못 남긴 것이 설치를 되돌릴 이유는 아니다 — 다만 조용히 삼키지는 않는다.
    st.disabled = true;
    process.stderr.write(`[warn] 실행 로그를 시작하지 못했습니다: ${e.message}\n`);
    return false;
  }
}

export function resetLogger() {
  state = null;
}

// 이번 실행의 로그 경로(레포 상대). 설치 요약 화면이 사용자에게 안내할 때 쓴다.
export function currentLogPath() {
  return state && !state.disabled ? state.rel : "";
}

// 구버전(.md) 설치 기록이 남아 있는지 — .gitignore는 이미 git이 추적 중인 파일에는
// 영향이 없으므로, 있으면 사용자가 직접 추적을 끊도록 안내해야 한다.
export function hasLegacyMdLogs(targetRoot) {
  try {
    const dir = join(targetRoot, LOG_DIR);
    return existsSync(dir) && readdirSync(dir).some((f) => f.endsWith(".md"));
  } catch { return false; }
}

// 열 너비 — 사람이 훑을 때 컬럼이 맞고, 에이전트가 컬럼 단위로 끊어 읽을 수 있게 고정한다.
const SCOPE_W = 8;  // 가장 긴 scope('baseline')에 맞춘다 — 컬럼이 밀리면 훑기가 나빠진다
const ACTION_W = 10;

// 동아시아 전각 문자는 폭 2로 센다 (요약 블록 정렬용).
const WIDE_RE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;
const dispWidth = (s) => [...String(s)].reduce((n, c) => n + (WIDE_RE.test(c) ? 2 : 1), 0);

// 헤더의 실행 시각과 파일명이 UTC 기준(utcNow)이므로 라인 시각도 UTC로 맞춘다 —
// 로컬 시간을 쓰면 같은 파일 안에서 헤더와 라인이 시간대만큼 어긋난다.
function hhmmss(date) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:${p(date.getUTCSeconds())}.${p(date.getUTCMilliseconds(), 3)}`;
}

function write(level, scope, action, detail = "") {
  if (!state || state.disabled) return;
  if (!state.file && !open(state)) return;
  try {
    const line = `${hhmmss(state.clock())} ${level}  ${String(scope).padEnd(SCOPE_W)}  ${String(action).padEnd(ACTION_W)}  ${detail}`.trimEnd();
    appendFileSync(state.file, line + "\n");
  } catch (e) {
    // 첫 실패에서 한 번만 알리고 이후는 조용히 끈다 — 매 줄 경고를 뱉으면 설치 화면이 무너진다.
    state.disabled = true;
    process.stderr.write(`[warn] 실행 로그 기록을 중단합니다: ${e.message}\n`);
  }
}

export const log = {
  info: (scope, action, detail) => write("INFO", scope, action, detail),
  warn: (scope, action, detail) => write("WARN", scope, action, detail),
  fail: (scope, action, detail) => write("FAIL", scope, action, detail),
  // rows: Array<[label, value]> — 라벨 폭을 맞춰 정렬한다.
  summary(rows = []) {
    if (!state || state.disabled || !rows.length) return;
    if (!state.file && !open(state)) return;
    // 한글은 터미널에서 2칸을 차지한다 — 문자 수로 맞추면 눈으로 볼 때 어긋난다.
    const w = Math.max(...rows.map(([k]) => dispWidth(k)));
    const body = rows.map(([k, v]) => `${k}${" ".repeat(w - dispWidth(k))} : ${v}`).join("\n");
    try {
      appendFileSync(state.file, `\n=== 요약 ===\n${body}\n`);
    } catch {
      state.disabled = true;
    }
  },
};

export function closeLogger() {
  state = null;
}
