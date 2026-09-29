// node:readline 기반 대화형 프롬프트 엔진 (@clack/prompts 대체).
// WHY: @clack/prompts 1.7.0 이 Windows TTY 콘솔에서 Enter(return) 키를 처리하지 못하고
//   멈추는 버그가 있다(실측 확정). node:readline 의 keypress 이벤트는 Windows에서 정상 동작한다.
//   .sh/.ps1 이 자체 메뉴를 구현한 것과 동일한 접근. 외부 의존성 0 → 내부망에서도 안전.
//
// 계약: ESC는 CANCEL 심볼 반환(호출부가 "기본값/머무르기"로 해석). 각 함수 async.
//       Ctrl+C·Ctrl+D·stdin 종료는 중단 — PromptAbortError로 reject해 어느 질문에서든 즉시 빠져나간다.
import { emitKeypressEvents } from "node:readline";
import { stdin, stdout } from "node:process";
import { visualWidth } from "./ansi.js";

export const CANCEL = Symbol("cancel");

// 사용자 중단(Ctrl+C 등). ESC와 달리 기본값으로 진행하면 안 되므로 반환값이 아니라 예외로 전파한다 —
// 호출부마다 CANCEL 해석이 달라 일부는 기본값으로 설치를 강행하거나 같은 화면을 무한히 다시 그렸다.
export class PromptAbortError extends Error {
  constructor() {
    super("사용자가 중단했습니다.");
    this.name = "PromptAbortError";
  }
}
export const isPromptAbort = (e) => e instanceof PromptAbortError;

// raw mode에서는 Ctrl+C가 SIGINT가 아니라 keypress로 들어온다. Ctrl+D도 raw mode에선 EOF가 아니다.
const isAbortKey = (key) => key.ctrl && (key.name === "c" || key.name === "d");

// ── ANSI 헬퍼 (picocolors 대체 — 의존성 0) ───────────────────────────
const ESC = "\x1b[";
const c = {
  reset: `${ESC}0m`, dim: `${ESC}2m`, bold: `${ESC}1m`,
  cyan: `${ESC}36m`, green: `${ESC}32m`, gray: `${ESC}90m`, yellow: `${ESC}33m`,
};
// NO_COLOR(https://no-color.org)/비TTY 가드 — ansi.js와 동일한 규칙(존재 여부만 체크, 값 무관)이지만
// 의존성 0 유지를 위해 자체 구현.
// TERM=dumb은 색상뿐 아니라 커서 이동·지우기 시퀀스도 해석하지 못한다 — 그때는 다시 그리지 않고 이어서 출력한다.
const isDumb = () => process.env.TERM === "dumb";
const colorEnabled = () => process.env.NO_COLOR === undefined && !!stdout.isTTY && !isDumb();
const paint = (s, color, enabled = colorEnabled()) => (enabled ? `${color}${s}${c.reset}` : String(s));
const hideCursor = () => { if (!isDumb()) stdout.write(`${ESC}?25l`); };
const showCursor = () => { if (!isDumb()) stdout.write(`${ESC}?25h`); };

// 심볼 (clack 톤 유지)
const S_ACTIVE = paint("●", c.green);
const S_INACTIVE = paint("○", c.dim);
const S_CHECK_ON = paint("◼", c.green);
const S_CHECK_OFF = paint("◻", c.dim);
const S_BAR = paint("│", c.gray);
const S_Q = paint("◆", c.cyan);
const S_DONE = paint("◇", c.green);

// 한 줄이 터미널에서 실제로 차지하는 행 수 — 폭을 넘는 줄은 터미널이 접어서 여러 행이 된다.
// 논리 줄 수만큼만 올라가면 접힌 윗부분이 지워지지 않고 화면에 사본이 쌓인다.
export function physicalRows(line, columns = stdout.columns) {
  if (!columns) return 1;
  return Math.max(1, Math.ceil(visualWidth(line) / columns));
}

// 여러 줄 지운 뒤 커서를 블록 시작으로 되돌리는 렌더러.
// 직전에 그린 물리 행 수만큼 위로 올라가 지우고 새로 그린다.
function makeRenderer() {
  let prevLines = 0;
  return {
    render(lines) {
      if (isDumb()) { stdout.write(lines.join("\n") + "\n"); return; }
      if (prevLines > 0) stdout.write(`${ESC}${prevLines}A`); // 위로
      stdout.write(`${ESC}0J`); // 커서 아래 전부 지우기
      stdout.write(lines.join("\n") + "\n");
      prevLines = lines.reduce((n, l) => n + physicalRows(l), 0);
    },
    reset() { prevLines = 0; },
  };
}

// raw keypress 세션 공통 래퍼. onKey(str,key) → true 반환 시 종료.
// 반환값은 finalize()가 만든다. 취소 시 CANCEL.
function keySession(renderFn, onKey) {
  return new Promise((resolve, reject) => {
    const wasRaw = stdin.isTTY ? stdin.isRaw : false;
    emitKeypressEvents(stdin);
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    hideCursor();

    const cleanup = () => {
      stdin.removeListener("keypress", handler);
      stdin.removeListener("end", onEnd);
      if (stdin.isTTY) stdin.setRawMode(wasRaw);
      stdin.pause();
      showCursor();
    };

    // stdin 종료(EOF, SSH 연결 끊김 등) — 더 이상 입력이 올 수 없으므로 중단한다.
    // CANCEL로 돌려주면 "머무르기"로 해석하는 화면에서 다시 묻다가 영원히 대기한다.
    const onEnd = () => {
      cleanup();
      reject(new PromptAbortError());
    };

    const handler = (str, key) => {
      key = key || {};
      if (isAbortKey(key)) {
        cleanup();
        stdout.write("\n");
        reject(new PromptAbortError());
        return;
      }
      if (key.name === "escape") {
        cleanup();
        resolve(CANCEL);
        return;
      }
      const done = onKey(str, key);
      if (done !== undefined) {
        cleanup();
        resolve(done);
      } else {
        renderFn();
      }
    };
    stdin.on("keypress", handler);
    stdin.on("end", onEnd);
    renderFn(); // 최초 렌더
  });
}

// ── 단일 선택 (방향키 + Enter) ───────────────────────────────────────
// options: [{value,label,hint?}]. 반환: 선택 value 또는 CANCEL.
export async function select({ message, options, initialIndex = 0 }) {
  if (!stdin.isTTY) {
    // 비-TTY: 기본값(첫 항목) 반환 — 파이프 환경 방어
    return options[initialIndex]?.value;
  }
  const r = makeRenderer();
  let idx = Math.max(0, Math.min(initialIndex, options.length - 1));

  const draw = () => {
    const lines = [S_BAR, `${S_Q}  ${paint(message, c.bold)}`];
    options.forEach((o, i) => {
      const sel = i === idx;
      const marker = sel ? S_ACTIVE : S_INACTIVE;
      const label = sel ? paint(o.label, c.cyan) : o.label;
      const hint = o.hint && sel ? paint(`  (${o.hint})`, c.dim) : "";
      lines.push(`${S_BAR}  ${marker} ${label}${hint}`);
    });
    lines.push(paint(`└  ↑/↓ 이동 · Enter 확정 · ESC 취소`, c.gray));
    r.render(lines);
  };

  const result = await keySession(draw, (str, key) => {
    if (key.name === "up" || key.name === "k") { idx = (idx - 1 + options.length) % options.length; return; }
    if (key.name === "down" || key.name === "j") { idx = (idx + 1) % options.length; return; }
    // 숫자 점프 (1-9)
    if (/^[1-9]$/.test(str || "")) {
      const n = Number(str) - 1;
      if (n < options.length) { idx = n; return; }
      return;
    }
    if (key.name === "return" || key.name === "enter") return options[idx].value;
    return; // 그 외 키: 무시하고 계속
  });

  // 확정 화면 다시 그리기 (◇ 완료 심볼 + 선택값)
  if (result !== CANCEL) {
    const chosen = options.find((o) => o.value === result);
    r.render([S_BAR, `${S_DONE}  ${paint(message, c.dim)}`, `${S_BAR}  ${paint(chosen?.label ?? "", c.dim)}`]);
  }
  return result;
}

// ── 다중 선택 (Space 토글 + Enter) ──────────────────────────────────
// options: [{value,label,hint?,disabled?}]. 반환: 선택 value 배열 또는 CANCEL.
export async function multiselect({ message, options, initialValues = [], required = false }) {
  if (!stdin.isTTY) {
    return initialValues.length ? [...initialValues] : (required ? [options[0]?.value].filter(Boolean) : []);
  }
  const r = makeRenderer();
  let idx = 0;
  const chosen = new Set(initialValues);
  let warn = "";

  const draw = () => {
    const lines = [S_BAR, `${S_Q}  ${paint(message, c.bold)}`];
    options.forEach((o, i) => {
      const cur = i === idx;
      const box = chosen.has(o.value) ? S_CHECK_ON : S_CHECK_OFF;
      const pointer = cur ? paint("❯", c.cyan) : " ";
      const label = cur ? paint(o.label, c.cyan) : (o.disabled ? paint(o.label, c.dim) : o.label);
      const hint = o.hint ? paint(`  (${o.hint})`, c.dim) : "";
      lines.push(`${S_BAR} ${pointer} ${box} ${label}${hint}`);
    });
    if (warn) lines.push(paint(`   ${warn}`, c.yellow));
    lines.push(paint(`└  ↑/↓ 이동 · Space 토글 · Enter 확정 · ESC 취소`, c.gray));
    r.render(lines);
  };

  const result = await keySession(draw, (str, key) => {
    warn = "";
    if (key.name === "up" || key.name === "k") { idx = (idx - 1 + options.length) % options.length; return; }
    if (key.name === "down" || key.name === "j") { idx = (idx + 1) % options.length; return; }
    if (key.name === "space" || str === " ") {
      const o = options[idx];
      if (o.disabled) { warn = "선택할 수 없는 항목입니다."; return; }
      if (chosen.has(o.value)) chosen.delete(o.value); else chosen.add(o.value);
      return;
    }
    if (key.name === "return" || key.name === "enter") {
      if (required && chosen.size === 0) { warn = "최소 1개 이상 선택하세요."; return; }
      return [...chosen];
    }
    return;
  });

  if (result !== CANCEL) {
    const labels = options.filter((o) => chosen.has(o.value)).map((o) => o.label).join(", ") || "(없음)";
    r.render([S_BAR, `${S_DONE}  ${paint(message, c.dim)}`, `${S_BAR}  ${paint(labels, c.dim)}`]);
  }
  return result;
}

// ── 텍스트 입력 (Enter 확정, 빈 입력=기본값) ─────────────────────────
// 반환: 입력 문자열(빈 입력 시 defaultValue) 또는 CANCEL.
export async function text({ message, defaultValue = "" }) {
  if (!stdin.isTTY) return defaultValue;
  return new Promise((resolve, reject) => {
    const wasRaw = stdin.isTTY ? stdin.isRaw : false;
    emitKeypressEvents(stdin);
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.resume();
    let buf = "";

    // dumb 터미널은 줄을 지울 수 없으므로 프롬프트는 한 번만 쓰고 입력 글자만 이어서 출력한다.
    const dumb = isDumb();
    let prevRows = 0; // 직전 프롬프트가 차지한 물리 행 수 — 긴 프롬프트는 여러 행으로 접힌다
    const prompt = () => {
      if (dumb) {
        stdout.write(`${S_Q}  ${message} ${defaultValue ? `[${defaultValue}] ` : ""}`);
        return;
      }
      // 커서는 접힌 마지막 행에 있으므로 첫 행까지 올라간 뒤 아래를 전부 지운다
      stdout.write(prevRows > 1 ? `\r${ESC}${prevRows - 1}A${ESC}0J` : `\r${ESC}0J`);
      const shown = buf.length ? buf : paint(defaultValue || "", c.dim);
      const line = `${S_Q}  ${paint(message, c.bold)} ${shown}`;
      stdout.write(line);
      prevRows = physicalRows(line);
    };

    const cleanup = () => {
      stdin.removeListener("keypress", handler);
      stdin.removeListener("end", onEnd);
      if (stdin.isTTY) stdin.setRawMode(wasRaw);
      stdin.pause();
      stdout.write("\n");
    };

    // stdin 종료(EOF) — 더 이상 입력이 올 수 없으므로 중단한다.
    const onEnd = () => {
      cleanup();
      reject(new PromptAbortError());
    };

    const handler = (str, key) => {
      key = key || {};
      if (isAbortKey(key)) { cleanup(); reject(new PromptAbortError()); return; }
      if (key.name === "escape") { cleanup(); resolve(CANCEL); return; }
      if (key.name === "return" || key.name === "enter") {
        cleanup();
        resolve(buf.length ? buf : defaultValue);
        return;
      }
      if (key.name === "backspace") {
        if (dumb && buf.length) stdout.write("\b \b");
        buf = buf.slice(0, -1);
        if (!dumb) prompt();
        return;
      }
      // 일반 문자 (제어문자 제외)
      if (str && !key.ctrl && !key.meta && str.length === 1 && str >= " ") {
        buf += str;
        if (dumb) stdout.write(str); else prompt();
        return;
      }
    };
    stdin.on("keypress", handler);
    stdin.on("end", onEnd);
    prompt();
  });
}

// ── Y/N 확인 (←→ 또는 y/n, Enter 확정) ──────────────────────────────
// 반환: true/false 또는 CANCEL.
export async function confirm({ message, initialValue = true }) {
  if (!stdin.isTTY) return initialValue;
  const r = makeRenderer();
  let val = initialValue;

  const draw = () => {
    const yes = val ? paint("● 예", c.green) : paint("○ 예", c.dim);
    const no = !val ? paint("● 아니오", c.green) : paint("○ 아니오", c.dim);
    r.render([S_BAR, `${S_Q}  ${paint(message, c.bold)}`, `${S_BAR}  ${yes}   ${no}`,
      paint(`└  ←/→ 또는 y/n · Enter 확정 · ESC 취소`, c.gray)]);
  };

  const result = await keySession(draw, (str, key) => {
    if (key.name === "left" || key.name === "right" || key.name === "tab") { val = !val; return; }
    if ((str || "").toLowerCase() === "y") { val = true; return; }
    if ((str || "").toLowerCase() === "n") { val = false; return; }
    if (key.name === "return" || key.name === "enter") return val;
    return;
  });

  if (result !== CANCEL) {
    r.render([S_BAR, `${S_DONE}  ${paint(message, c.dim)}`, `${S_BAR}  ${paint(result ? "예" : "아니오", c.dim)}`]);
  }
  return result;
}

// ── 출력 헬퍼 (clack intro/outro/note/cancel 대체) ──────────────────
export function intro(text) { stdout.write(`\n${paint("┌", c.gray)}  ${paint(text, c.bold)}\n`); }
export function outro(text) { stdout.write(`${paint("└", c.gray)}  ${paint(text, c.green)}\n\n`); }
export function cancelMessage(text = "취소했습니다.") { stdout.write(`${paint("■", c.yellow)}  ${paint(text, c.yellow)}\n`); }
export function note(text, title = "") {
  const lines = String(text).split("\n");
  stdout.write(`${paint("○", c.cyan)} ${paint(title, c.bold)}\n`);
  for (const l of lines) stdout.write(`${S_BAR}  ${l}\n`);
  stdout.write(`${S_BAR}\n`);
}
export function log(text = "") { stdout.write(`${text}\n`); }
