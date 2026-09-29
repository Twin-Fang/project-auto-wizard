// 공통 조각(templates/workflows/*.yaml)에 타입별 값을 채워 payload 워크플로우를 만든다.
//
//   node scripts/generate-workflows.mjs          # 생성 결과를 payload 파일에 쓴다
//   node scripts/generate-workflows.mjs --check  # 쓰지 않고 비교만 — 어긋나면 exit 1
//
// 사용자 레포에 설치되는 것은 생성된 payload 파일이고, 조각과 이 스크립트는 패키지에 포함되지 않는다.
// 그래서 생성 결과는 항상 커밋하고, --check(테스트가 호출)로 조각·값·payload가 어긋나는 것을 막는다.
//
// 조각 문법: `%%NAME%%`
//   - 한 줄에 자리표시자만 있으면 그 줄 전체를 대체한다. 값은 줄 배열이고 자리표시자의 들여쓰기를
//     각 줄 앞에 붙인다. 빈 배열이면 줄이 사라진다 (타입에 따라 있거나 없는 주석용).
//   - 줄 중간에 있으면 문자열 값으로 그 자리만 치환한다.
//   - 값이 없는 자리표시자, 쓰이지 않는 값은 조용히 넘어가지 않고 실패시킨다.
// 설치기와 마찬가지로 외부 의존성 없이 node:* 내장 모듈만 쓴다.
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TARGETS } from "../templates/workflows/targets.mjs";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = /%%([A-Z][A-Z0-9_]*)%%/g;
const LINE_TOKEN = /^(\s*)%%([A-Z][A-Z0-9_]*)%%$/;

// 조각 하나에 값을 채운 텍스트를 돌려준다.
export function render(template, vars, label = "template") {
  const used = new Set();
  const take = (name) => {
    if (!Object.hasOwn(vars, name)) throw new Error(`${label}: 값이 없는 자리표시자 %%${name}%%`);
    used.add(name);
    return vars[name];
  };

  const out = [];
  for (const line of template.split("\n")) {
    const whole = LINE_TOKEN.exec(line);
    if (whole) {
      const value = take(whole[2]);
      if (!Array.isArray(value)) throw new Error(`${label}: %%${whole[2]}%%는 줄 전체 자리표시자라 배열 값이 필요하다`);
      for (const v of value) out.push(whole[1] + v);
      continue;
    }
    out.push(
      line.replace(TOKEN, (_, name) => {
        const value = take(name);
        if (typeof value !== "string") throw new Error(`${label}: %%${name}%%는 줄 중간에 있어 문자열 값이 필요하다`);
        return value;
      }),
    );
  }

  const unused = Object.keys(vars).filter((k) => !used.has(k));
  if (unused.length) throw new Error(`${label}: 조각에서 쓰지 않는 값 ${unused.join(", ")}`);
  return out.join("\n");
}

// 생성 대상 각각의 기대 내용과 현재 파일을 비교한다.
export function plan(root = DEFAULT_ROOT, targets = TARGETS) {
  return targets.map((t) => {
    const template = readFileSync(join(root, "templates/workflows", t.template), "utf8");
    const expected = render(template, t.vars, t.out);
    const file = join(root, t.out);
    const actual = existsSync(file) ? readFileSync(file, "utf8") : null;
    return { out: t.out, file, expected, ok: actual === expected };
  });
}

function main() {
  const check = process.argv.includes("--check");
  const results = plan();
  const stale = results.filter((r) => !r.ok);

  if (check) {
    for (const r of stale) console.error(`어긋남: ${r.out} — npm run generate:workflows 로 다시 생성하세요`);
    if (stale.length) process.exit(1);
    console.log(`생성 대상 ${results.length}개가 모두 일치합니다`);
    return;
  }
  for (const r of stale) {
    writeFileSync(r.file, r.expected);
    console.log(`생성: ${r.out}`);
  }
  if (!stale.length) console.log("바뀐 파일이 없습니다");
}

// 테스트가 import할 때는 실행하지 않는다
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
