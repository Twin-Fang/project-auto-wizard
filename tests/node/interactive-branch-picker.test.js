// tests/node/interactive-branch-picker.test.js
// 이슈 #85 — pickBranch()가 select()에 정렬된 options와 initialIndex를 넘기는지 검증.
import { test } from "node:test";
import assert from "node:assert";
import { pickBranch } from "../../src/commands/interactive.js";

const isCancel = () => false;

function stubSelectIo(returnValue) {
  const calls = [];
  return {
    io: {
      engineIo: {
        select: async (args) => { calls.push(args); return returnValue; },
      },
    },
    calls,
  };
}

test("pickBranch: def가 목록 중간에 있어도 정렬된 options 맨 앞에 오고 initialIndex가 그 위치를 가리킨다", async () => {
  const { io, calls } = stubSelectIo("main");
  const remoteBranches = ["20260810_feature", "develop", "main", "zzz-old"];
  const result = await pickBranch(io, "릴리스 브랜치를 선택하세요 (기본: main)", "main", remoteBranches, isCancel);

  assert.strictEqual(result, "main");
  assert.strictEqual(calls.length, 1);
  const { options, initialIndex } = calls[0];
  assert.strictEqual(options[initialIndex].value, "main", "initialIndex가 가리키는 옵션은 def(main)여야 한다");
  assert.deepStrictEqual(
    options.map((o) => o.value),
    ["main", "develop", "20260810_feature", "zzz-old", "__custom__"],
  );
});

test("pickBranch: 개발 브랜치 프롬프트(def=develop)에서도 커서가 develop을 가리킨다", async () => {
  const { io, calls } = stubSelectIo("develop");
  const remoteBranches = ["20260810_feature", "develop", "main"];
  const result = await pickBranch(io, "개발 브랜치를 선택하세요 (기본: develop)", "develop", remoteBranches, isCancel);

  assert.strictEqual(result, "develop");
  const { options, initialIndex } = calls[0];
  assert.strictEqual(options[initialIndex].value, "develop");
  assert.deepStrictEqual(
    options.map((o) => o.value),
    ["develop", "main", "20260810_feature", "__custom__"],
  );
});

test("pickBranch: def가 원격에 없는 신규 브랜치면 플레이스홀더가 맨 앞(index 0)에 오고 initialIndex도 0이다", async () => {
  const { io, calls } = stubSelectIo("release");
  const remoteBranches = ["20260810_feature", "develop"];
  const result = await pickBranch(io, "릴리스 브랜치를 선택하세요 (기본: release)", "release", remoteBranches, isCancel);

  assert.strictEqual(result, "release");
  const { options, initialIndex } = calls[0];
  assert.strictEqual(initialIndex, 0);
  assert.strictEqual(options[0].value, "release");
  assert.strictEqual(options[0].label, "release (기본값 — 없으면 새로 생성)");
});

test("pickBranch: 사용자가 다른 브랜치를 선택하면 그 값을 그대로 반환한다(정렬은 선택 결과에 영향 없음)", async () => {
  const { io } = stubSelectIo("develop");
  const remoteBranches = ["20260810_feature", "develop", "main"];
  const result = await pickBranch(io, "릴리스 브랜치를 선택하세요 (기본: main)", "main", remoteBranches, isCancel);
  assert.strictEqual(result, "develop");
});

test("pickBranch: engineIo.select가 없으면(비-TTY) 기존처럼 askText로 폴백한다 — 회귀 확인", async () => {
  const askTextCalls = [];
  const io = { askText: async (message, def) => { askTextCalls.push({ message, def }); return def; } };
  const result = await pickBranch(io, "릴리스 브랜치를 선택하세요 (기본: main)", "main", ["develop", "main"], isCancel);
  assert.strictEqual(result, "main");
  assert.strictEqual(askTextCalls.length, 1);
});
