# 서버 배포 방식 "배포 안 함(none)" 옵션 추가 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서버 배포 방식을 묻는 대화형 select(`src/core/deploy-style.js`의 `DEPLOY_STYLES`)에 4번째 선택지 `"none"`(서버 배포 안 함)을 추가해, 서버 배포 자체를 하지 않는 프로젝트(프론트엔드 전용, 라이브러리 등)도 강제로 `simple`/`nginx`/`traefik` 중 하나를 고르지 않아도 되게 한다.

**Architecture:** `"none"`은 기존 `DEPLOY_STYLES` 배열에 넣지 않고 별도 상수(`NO_DEPLOY_STYLE`)로 분리해 순수 로직 계층(`deploy-style.js`)만 최소 확장한다(Task 1). `isDeployWorkflow`/`suffixOf`/`activateDeployTrigger`/`cleanupOtherDeployWorkflows` 자체는 손대지 않는다. 그 위에서 UI 옵션 목록·CLI 검증 메시지·`server-deploy` 폴더(PR 프리뷰 포함) 배제 로직·env 질문 스캔 범위·문서 3곳을 배선한다(Task 2) — Nexus 모드가 이미 같은 폴더를 제외하는 것과 동일한 패턴을 그대로 재사용한다.

**Tech Stack:** Node.js (ESM), `node:test` + `node:assert` (테스트), 외부 프레임워크 없음.

**Spec:** GitHub 이슈 [#126](https://github.com/Twin-Fang/project-auto-wizard/issues/126) (로컬 사본: `.issue/#20260904_001_기능개선_서버_배포_안함_옵션_추가.md`). `mattpocock-skills:grilling` 브레인스토밍 + `claude-fable-5-1` 모델 설계 리스크 검토를 거쳐 확정된 설계다.

## Global Constraints

- `"none"`은 `DEPLOY_STYLES` 배열에 절대 추가하지 않는다 — `isDeployWorkflow`/`suffixOf`가 이 배열을 순회하므로, 빈 접미사를 넣으면 `filename.endsWith("")`가 항상 참이 되어 모든 파일이 CD로 오판되고 `cleanupOtherDeployWorkflows`가 설치된 워크플로우 전체를 삭제하는 회귀가 생긴다.
- 커밋 메시지는 한국어로 작성한다. Conventional Commits 타입 접두사(`feat:`, `fix:`, `test:`, `docs:` 등)는 영어를 유지한다 (프로젝트 `CLAUDE.md`).
- 테스트는 `node:test` + `node:assert` 기반이며, 새 테스트 파일을 만들지 않고 기존 파일(`tests/node/deploy-style.test.js`, `tests/node/env-plan.test.js`)에 이어서 추가한다.
- UI 노트/라벨 문구, 코드 주석은 기존 한국어 톤(간결한 서술형, "왜"를 설명하는 주석)을 그대로 따른다.
- `docs/DESIGN-SPEC.md`·`README.md`는 이번 변경으로 사실과 달라지는 문장만 최소 수정한다 — 이슈 #93 때 문서 미갱신이 discoverability 문제로 지적된 전례를 반복하지 않는다.
- **설계에서 정정된 사항**: 이슈 #126 본문은 "`install-log.js` 설치 요약표에 `서버 배포: 없음` 표기"를 언급하지만, 실제로는 그런 파일도, 배포 방식을 보여주는 요약 행도 존재하지 않는다(`src/commands/full.js:114-123`의 `log.summary()`는 simple/nginx/traefik 어느 것도 표시하지 않는다). 기존 3개 방식에도 없는 표시를 `none`에만 새로 추가하는 것은 범위 밖이므로 **이 계획에서는 요약 표시 작업을 하지 않는다.**

---

### Task 1: 순수 로직 계층 — `deploy-style.js`에 `NO_DEPLOY_STYLE` 추가

**Files:**
- Modify: `src/core/deploy-style.js:9-31`
- Test: `tests/node/deploy-style.test.js`

**Interfaces:**
- Produces: `NO_DEPLOY_STYLE`(문자열 상수, 값 `"none"`), `isDeployStyle(v)`(`"none"` 포함하도록 확장), `deployFilter(style)`(`style === "none"`일 때 `(filename) => !isDeployWorkflow(filename)`를 반환하도록 확장). `DEPLOY_STYLES`/`isDeployWorkflow`/`suffixOf`/`activateDeployTrigger`/`cleanupOtherDeployWorkflows`는 시그니처·동작 무변경 — Task 2가 그대로 가져다 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/node/deploy-style.test.js` 상단 import에 `NO_DEPLOY_STYLE`을 추가한다:

```javascript
import {
  deployFilter, isDeployWorkflow, activateDeployTrigger, isDeployStyle, DEFAULT_DEPLOY_STYLE,
  NO_DEPLOY_STYLE, cleanupOtherDeployWorkflows,
} from "../../src/core/deploy-style.js";
import { sha256 } from "../../src/core/baseline.js";
```

`test("--deploy-style: 값 검증", ...)` (기존 50~57행)를 아래로 교체한다 — 기존 어서션에 `"none"` 케이스를 더한 것이다:

```javascript
test("--deploy-style: 값 검증", () => {
  assert.strictEqual(parseArgs(["--deploy-style", "nginx"]).deployStyle, "nginx");
  assert.strictEqual(parseArgs(["--deploy-style", "none"]).deployStyle, "none");
  assert.strictEqual(parseArgs([]).deployStyle, "", "미지정은 빈값 → 저장값 또는 기본값(simple)");
  assert.throws(() => parseArgs(["--deploy-style", "k8s"]), /deploy-style/);
  assert.throws(() => parseArgs(["--deploy-style"]), /deploy-style/);
  assert.ok(isDeployStyle("traefik") && isDeployStyle("none") && !isDeployStyle("k8s") && !isDeployStyle("all"));
  assert.strictEqual(DEFAULT_DEPLOY_STYLE, "simple");
  assert.strictEqual(NO_DEPLOY_STYLE, "none");
});
```

파일 끝(기존 159~162행 다음)에 새 테스트 3개를 추가한다:

```javascript
test("deployFilter('none'): CD 워크플로우 3종을 모두 제외하고 PR 프리뷰·common은 통과시킨다", () => {
  const keep = deployFilter("none");
  assert.ok(!keep(SIMPLE));
  assert.ok(!keep(NGINX));
  assert.ok(!keep(TRAEFIK));
  assert.ok(keep(PREVIEW), "PR 프리뷰는 deployFilter 자체로는 배제 대상이 아니다 (폴더째 제외는 Task 2가 배선)");
  assert.ok(keep("PROJECT-COMMON-RELEASE-PUBLISH.yaml"));
});

test("'none' 추가가 기존 판별 로직을 건드리지 않는다 — isDeployWorkflow는 무변경, 알 수 없는 값은 여전히 simple로 수렴한다", () => {
  assert.ok(isDeployWorkflow(SIMPLE) && isDeployWorkflow(NGINX) && isDeployWorkflow(TRAEFIK));
  assert.ok(!isDeployWorkflow(PREVIEW));
  const keepUnknown = deployFilter("잘못된값");
  assert.ok(keepUnknown(SIMPLE));
  assert.ok(!keepUnknown(NGINX));
  assert.ok(!keepUnknown(TRAEFIK));
});

test("cleanupOtherDeployWorkflows: 'none'으로 전환하면 손대지 않은 이전 CD는 정리하고 PR 프리뷰는 남긴다", () => {
  const dir = mkdtempSync(join(tmpdir(), "paw-deploy-cleanup-"));
  try {
    const simpleContent = "name: simple\n";
    const previewContent = "name: preview\n";
    writeFileSync(join(dir, SIMPLE), simpleContent);
    writeFileSync(join(dir, PREVIEW), previewContent);
    const baseline = { files: { [SIMPLE]: { installed: sha256(simpleContent) } } };

    const result = cleanupOtherDeployWorkflows(dir, [SIMPLE, PREVIEW], "none", baseline);

    assert.deepStrictEqual(result.removed, [SIMPLE]);
    assert.deepStrictEqual(result.backedUp, []);
    assert.ok(!readdirSync(dir).includes(SIMPLE), "손대지 않은 이전 CD는 삭제된다");
    assert.ok(readdirSync(dir).includes(PREVIEW), "PR 프리뷰는 CD가 아니므로 cleanup 대상이 아니다");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test tests/node/deploy-style.test.js`
Expected: FAIL — `NO_DEPLOY_STYLE`가 `deploy-style.js`에 없어 import 단계에서 `undefined`가 되고, `isDeployStyle("none")`이 `false`를 반환해 새 어서션들이 깨진다.

- [ ] **Step 3: 최소 구현 — `src/core/deploy-style.js` 수정**

`export const DEFAULT_DEPLOY_STYLE = "simple";` 바로 다음, `export const isDeployStyle = ...` 바로 앞에 삽입:

```javascript
// 서버 배포 자체를 하지 않는 프로젝트(프론트엔드 전용, 라이브러리 등)를 위한 값.
// DEPLOY_STYLES에는 넣지 않는다 — isDeployWorkflow/suffixOf가 이 배열을 순회하는데, 빈 접미사를
// 돌려주면 endsWith("")가 항상 참이라 모든 파일이 CD로 오판되어 cleanupOtherDeployWorkflows가
// 설치된 워크플로우 전체를 지우는 회귀가 생긴다 (이슈 #126).
export const NO_DEPLOY_STYLE = "none";
```

`isDeployStyle` 정의를 교체:

```javascript
export const isDeployStyle = (v) => v === NO_DEPLOY_STYLE || DEPLOY_STYLES.some((s) => s.value === v);
```

`deployFilter` 정의를 교체:

```javascript
// 파일 필터 — 고른 방식의 CD만 통과. CD가 아닌 파일(PR 프리뷰·common 등)은 항상 통과.
// "none"은 CD를 하나도 설치하지 않으므로 접미사 매칭 없이 CD 파일 전부를 거른다.
export function deployFilter(style) {
  if (style === NO_DEPLOY_STYLE) return (filename) => !isDeployWorkflow(filename);
  const suffix = suffixOf(style);
  return (filename) => !isDeployWorkflow(filename) || filename.endsWith(suffix);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/node/deploy-style.test.js`
Expected: PASS — 기존 테스트 포함 전부 통과.

- [ ] **Step 5: 커밋**

```bash
git add src/core/deploy-style.js tests/node/deploy-style.test.js
git commit -m "$(cat <<'EOF'
feat: 배포 방식에 NO_DEPLOY_STYLE("none") 상수 추가

DEPLOY_STYLES 배열에 직접 넣으면 isDeployWorkflow/suffixOf가 전체 순회하며
빈 접미사의 endsWith("")가 항상 참이 되어 모든 파일을 CD로 오판하는 회귀가
생기므로, 별도 상수로 분리하고 isDeployStyle/deployFilter만 확장했다.
EOF
)"
```

---

### Task 2: 배선 + 통합 — UI/CLI/워크플로우 복사/env 질문/문서

**Files:**
- Modify: `src/ui/prompts.js:5,88-98`
- Modify: `src/cli/args.js:3,80-86`
- Modify: `src/cli/help.js:19`
- Modify: `src/core/copy/workflows.js:6,326-374,272-304,376-434`
- Modify: `src/ui/env-plan.js:13,41-64`
- Modify: `README.md:71,73,156`
- Modify: `docs/DESIGN-SPEC.md:40,85`
- Modify: `payload/version.yml.template:50`
- Test: `tests/node/deploy-style.test.js` (통합 테스트 추가)
- Test: `tests/node/env-plan.test.js` (단위 테스트 추가)

**Interfaces:**
- Consumes: Task 1의 `NO_DEPLOY_STYLE`("none"), `isDeployStyle`, `deployFilter` — 전부 이미 `"none"`을 올바르게 처리한다.
- Produces: 사용자가 select에서 `"서버 배포 안 함"`을 고르거나 `--deploy-style none`을 지정하면 CD 3종과 `server-deploy` 폴더 전체(PR 프리뷰 포함)가 설치·질문에서 제외된다. 이후 태스크는 없다(이번 이슈의 마지막 태스크).

- [ ] **Step 1: 실패하는 통합 테스트 작성 — `runFull`이 'none'일 때 PR 프리뷰까지 제외하는지**

`tests/node/deploy-style.test.js` 파일 끝에 추가:

```javascript
test("runFull: 'none'을 고르면 CD는 물론 PR 프리뷰까지 설치되지 않는다", () => {
  const target = springTarget();
  try {
    install(target, "none");
    const files = readdirSync(join(target, ".github/workflows")).filter((f) => f.includes("SPRING"));
    assert.deepStrictEqual(files, [], "server-deploy 폴더 전체(PR 프리뷰 포함)가 제외돼야 한다");
  } finally { rmSync(target, { recursive: true, force: true }); }
});

test("runFull: simple로 설치 후 'none'으로 전환하면 SIMPLE CD는 정리되지만 이미 깔린 PR 프리뷰는 남는다", () => {
  const target = springTarget();
  try {
    install(target, "simple");
    const r = install(target, "none");
    assert.deepStrictEqual(r.cleanup.removed, [SIMPLE]);
    const files = readdirSync(join(target, ".github/workflows")).filter((f) => f.includes("SPRING"));
    assert.deepStrictEqual(files, [PREVIEW],
      "PR 프리뷰는 CD가 아니라 cleanup 대상이 아니다 — 폴더 제외는 신규 설치 범위에만 적용되는 기존 제약");
  } finally { rmSync(target, { recursive: true, force: true }); }
});
```

`tests/node/env-plan.test.js` 파일 끝(기존 184~188행 다음)에 추가:

```javascript
test("collectAsks: deployStyle이 'none'이면 server-deploy 폴더(PR 프리뷰 포함) 전체를 스캔하지 않는다", () => {
  const asks = collectAsks(resolvePayloadRoot(), ["spring"], { deployStyle: "none" });
  assert.ok(!asks.keys.includes("VOLUME_CONTAINER_PATH"), "nginx/traefik 전용 키는 스캔되지 않아야 한다");
  assert.ok(!asks.keys.includes("SSH_AUTH_METHOD"),
    "server-deploy 4개 파일(SIMPLE/NGINX/TRAEFIK/PR 프리뷰) 공통 ask 키 — 이게 없다는 것이 폴더 전체가 스캔에서 빠졌다는 증거다");
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test tests/node/deploy-style.test.js tests/node/env-plan.test.js`
Expected: FAIL — `"none"`이 아직 select 옵션에도 없고, `copyWorkflowsForType`/`collectAsks`가 `deployStyle === "none"`을 특별 취급하지 않아 PR 프리뷰(및 `SSH_AUTH_METHOD` 등)가 여전히 설치·스캔된다.

- [ ] **Step 3: `src/ui/prompts.js` 수정 — select에 4번째 옵션 추가**

Import 줄 교체:

```javascript
import { DEPLOY_STYLES, NO_DEPLOY_STYLE } from "../core/deploy-style.js";
```

`selectDeployStyle` 함수 전체를 교체:

```javascript
// 배포 방식 선택 (이슈 #80, #126). 서버 배포 CD 워크플로우는 서로 대체재라 하나만 쓴다.
// 고른 것만 설치하고 push 트리거까지 켜준다 — 종전에는 넷을 다 깔고 SIMPLE만 켜져 있어,
// 무중단을 원한 사람은 설치 후 YAML을 직접 고쳐야 했다.
// "서버 배포 안 함"은 server-deploy 폴더 자체(PR 프리뷰 포함)를 제외한다 — 서버 배포를
// 하지 않는 프로젝트(프론트엔드 전용, 라이브러리 등)를 위한 선택지다.
export async function selectDeployStyle() {
  engine.note(
    "서버 배포 워크플로우는 서로 대체재입니다 (Nginx와 Traefik을 동시에 쓰지 않습니다).\n" +
    "고른 방식만 설치하고 자동 실행(push 트리거)까지 켭니다. PR 프리뷰는 선택과 무관하게 함께 설치됩니다\n" +
    "(단, \"서버 배포 안 함\"을 고르면 PR 프리뷰도 함께 제외됩니다).",
    "배포 방식",
  );
  return engine.select({
    message: "서버 배포는 어떤 방식으로 할까요?",
    options: [
      ...DEPLOY_STYLES.map((s) => ({ value: s.value, label: s.label })),
      { value: NO_DEPLOY_STYLE, label: "서버 배포 안 함 — CD 워크플로우/배포 설정을 생성하지 않음" },
    ],
  });
}
```

- [ ] **Step 4: `src/cli/args.js` 수정 — 오류 메시지에 `none` 포함**

Import 줄 교체:

```javascript
import { DEPLOY_STYLES, isDeployStyle, NO_DEPLOY_STYLE } from "../core/deploy-style.js";
```

`--deploy-style` case 블록 교체 (검증 자체는 `isDeployStyle`가 이미 `"none"`을 통과시키므로 무변경 — 오류 메시지 목록만 갱신):

```javascript
      case "--deploy-style": {
        const v = args.shift();
        if (!isDeployStyle(v)) {
          throw new CliError(`--deploy-style 값이 올바르지 않습니다: ${v ?? "(없음)"} (${[...DEPLOY_STYLES.map((s) => s.value), NO_DEPLOY_STYLE].join(" | ")})`);
        }
        result.deployStyle = v; break;
      }
```

- [ ] **Step 5: `src/cli/help.js` 수정**

19행 교체:

```javascript
      --deploy-style STYLE           서버 배포 방식: simple | nginx | traefik | none (기본: simple)
```

- [ ] **Step 6: `src/core/copy/workflows.js` 수정 — `server-deploy` 폴더 배제 3곳 + env 치환 루프**

Import 줄(6행) 교체:

```javascript
import { deployFilter, isDeployWorkflow, activateDeployTrigger, DEFAULT_DEPLOY_STYLE, NO_DEPLOY_STYLE } from "../deploy-style.js";
```

`copyWorkflowsForType` 함수(326~374행) 중, server-deploy 복사 분기(343~351행)를 교체:

```javascript
  // server-deploy
  const serverDeployDir = join(typeDir, "server-deploy");
  if (exists(serverDeployDir)) {
    if (includeNexus || deployStyle === NO_DEPLOY_STYLE) {
      // Nexus 프로젝트 또는 "배포 안 함" → 폴더째 제외 (복사 안 함)
    } else {
      const c = processDir(serverDeployDir, workflowsDir, envOpts, dirCtx, counters, keepDeploy);
      untouched.push(...c.unchanged, ...c.localOnly);
    }
  }
```

같은 함수의 env 치환 루프(363~373행)를 교체 — 폴더째 제외됐을 때는 `keepDeploy`로 개별 파일을 거르지 않고 `server-deploy` 자체를 통째로 건너뛴다(재설치로 이미 디스크에 남아 있는 PR 프리뷰가 이번 실행의 env 계획에 없는 값으로 잘못 재치환되는 것을 막는다):

```javascript
  // env 치환 — 이 타입의 원본 디렉토리들에서 복사돼 존재하고, 손대지 않기로 한 것이 아닌 파일만
  for (const srcDir of [typeDir, serverDeployDir, nexusDir]) {
    if (!exists(srcDir)) continue;
    if (srcDir === serverDeployDir && (includeNexus || deployStyle === NO_DEPLOY_STYLE)) continue; // 폴더째 제외
    for (const filename of listYamlFiles(srcDir)) {
      const target = join(workflowsDir, filename);
      if (srcDir === serverDeployDir && !keepDeploy(filename)) continue; // 안 고른 배포 방식
      if (!existsSync(target)) continue;          // 건너뛴 파일 제외
      if (untouched.includes(filename)) continue; // unchanged/localOnly 제외
      configureEnv(target, { ...envOpts, collectAsks }); // env 계획 values/useDefaults 포함
    }
  }
```

`surveyWorkflows` 함수(272~304행) 중 server-deploy 수집 줄(300~301행)을 교체:

```javascript
    const serverDeployDir = join(typeDir, "server-deploy");
    if (exists(serverDeployDir) && !includeNexus && deployStyle !== NO_DEPLOY_STYLE) {
      collect(serverDeployDir, envOpts, type, () => false, keepDeploy);
    }
```

`planWorkflows` 함수(376~434행) 중 server-deploy 병합 줄(422~425행)을 교체:

```javascript
    const serverDeployDir = join(typeDir, "server-deploy");
    if (exists(serverDeployDir) && !includeNexus && deployStyle !== NO_DEPLOY_STYLE) {
      merge(classify(serverDeployDir, workflowsDir, envOpts, srcText, baseline, deployFilter(deployStyle)), type);
    }
```

- [ ] **Step 7: `src/ui/env-plan.js` 수정 — `collectAsks`가 'none'일 때 server-deploy를 스캔 단위에서 아예 제외**

Import 줄(13행) 교체:

```javascript
import { deployFilter, NO_DEPLOY_STYLE } from "../core/deploy-style.js";
```

`collectAsks` 함수의 단위 구성 루프(58~64행) 중 server-deploy/nexus 푸시 줄(62~63행)을 교체:

```javascript
  for (const type of types) {
    const typeDir = join(baseDir, type);
    if (!exists(typeDir)) continue;
    // 복사 엔진과 동일한 폴더 구성: 타입 직하위 + (nexus면) nexus + (그 외엔, "배포 안 함"이
    // 아닐 때만) server-deploy. "none"은 이 유닛 자체를 스캔에서 뺀다 — PR 프리뷰의 SSH 관련
    // 질문까지 함께 걸러야 "배포 설정을 생성하지 않음" 라벨과 실제 동작이 맞는다.
    units.push([type, typeDir, null]);
    if (includeNexus) {
      units.push([type, join(typeDir, "nexus"), null]);
    } else if (deployStyle !== NO_DEPLOY_STYLE) {
      units.push([type, join(typeDir, "server-deploy"), keepDeploy]);
    }
  }
```

- [ ] **Step 8: 테스트 통과 확인**

Run: `node --test tests/node/deploy-style.test.js tests/node/env-plan.test.js`
Expected: PASS — 전부 통과.

- [ ] **Step 9: 문서 갱신 — `README.md`**

71행 교체:

```markdown
- **spring**: 서버 배포 1종(단일 서버 / 무중단 Nginx / 무중단 Traefik / 배포 안 함 중 택1) + PR 프리뷰 + 라이브러리 publish 2종(Nexus·GitHub Packages, `--nexus` opt-in)
  - 서버 배포 워크플로우는 **서로 대체재**라 하나만 설치합니다. 대화형에서 고르면 그것만 깔리고 **`push` 트리거까지 켜진 채로** 설치됩니다. 비대화형은 `--deploy-style simple|nginx|traefik|none` (기본: `simple`).
```

73행 교체:

```markdown
  - PR 프리뷰는 배포 방식과 무관한 별개 축이라 선택과 관계없이 함께 설치됩니다 (단, `none`을 고르면 PR 프리뷰도 함께 제외됩니다 — 서버 배포 자체를 하지 않는 프로젝트를 위한 선택지입니다).
```

156행 교체:

```markdown
      --deploy-style S     서버 배포 방식: simple | nginx | traefik | none (기본: simple)
```

- [ ] **Step 10: 문서 갱신 — `docs/DESIGN-SPEC.md`**

40행 교체:

```markdown
│   │   │   ├── server-deploy/   # 기본 포함, Nexus opt-in true 또는 배포 방식 "none"이면 폴더째 제외
```

85행 교체:

```markdown
- Nexus (`--nexus`): spring 라이브러리 publish. true면 `server-deploy/` 폴더 자동 제외. 배포 방식이 `none`(서버 배포 안 함)이어도 동일하게 폴더째 제외.
```

- [ ] **Step 11: 문서 갱신 — `payload/version.yml.template`**

50행 교체:

```yaml
      deploy_style: "{{OPT_DEPLOY_STYLE}}" # simple | nginx | traefik | none (서버 배포 워크플로우)
```

- [ ] **Step 12: 전체 테스트 스위트 실행**

Run: `node --test tests/node/`
Expected: PASS — 전체 통과, 기존 테스트 회귀 없음.

- [ ] **Step 13: 커밋**

```bash
git add src/ui/prompts.js src/cli/args.js src/cli/help.js src/core/copy/workflows.js src/ui/env-plan.js \
  README.md docs/DESIGN-SPEC.md payload/version.yml.template \
  tests/node/deploy-style.test.js tests/node/env-plan.test.js
git commit -m "$(cat <<'EOF'
feat: 서버 배포 방식 선택에 "배포 안 함(none)" 옵션 배선

select 4번째 옵션, --deploy-style none, server-deploy 폴더(PR 프리뷰 포함)
전체 제외를 Nexus와 동일한 패턴으로 배선하고 env 질문 스캔에서도 뺐다.
README/DESIGN-SPEC/version.yml.template 문서도 함께 갱신했다.

Closes #126
EOF
)"
```

---

## 이후 단계 (계획 실행 완료 후, 이 계획서 범위 밖)

1. `git checkout -b "20260904_#126_서버_배포_방식_선택에_배포_안_함_none_옵션_추가"` (브랜치는 GitHub 이슈 헬퍼가 이미 생성한 이름을 그대로 사용 — `EnterWorktree`는 쓰지 않는다. 이 도구가 자동 생성하는 `worktree-<name>` 형식은 `#` 문자가 없어 `/prp-pr`의 이슈 번호 자동 추출 정규식이 실패하는 이 저장소의 알려진 문제가 있다).
2. Task 1 구현 → 리뷰 → Task 2 구현 → 리뷰.
3. 전체 브랜치 리뷰(code-reviewer 또는 opus).
4. **claude-fable-5-1 모델 독립 최종 리뷰** — 실제 구현 diff 기준으로, 설계 단계에서 이미 완료한 리스크 검토와 별개로 한 번 더 수행한다.
5. `/prp-commit` → `/prp-pr` (PR 본문에 `Closes #126` 포함, 이슈 자동 종료 연결).
