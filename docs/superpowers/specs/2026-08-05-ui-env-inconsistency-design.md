# stdin 종료 미처리·색상 비일관·대화형 메뉴 누락·jq 폴백 무경고 (4건) — 브레인스토밍 결과

- 날짜: 2026-08-05
- 상태: 브레인스토밍 완료 (사용자 승인 완료 — 구현 계획 단계로 진행)
- 이슈: [Twin-Fang/project-auto-wizard#22](https://github.com/Twin-Fang/project-auto-wizard/issues/22)
- 브랜치: `20260804_#22_stdin_종료_미처리_색상_비일관_대화형_메뉴_누락_jq_폴백_무경고_4건`
- 관련: [Twin-Fang/project-auto-wizard#11](https://github.com/Twin-Fang/project-auto-wizard/issues/11) QA에서 발견된 4건을 하나로 묶은 이슈
- 참고: 이 문서는 **설계 스펙**이다. 실제 구현 순서/작업 단위는 별도 `writing-plans` 세션에서 다룬다.

## 1. 배경 — 문제 정의

이슈 #11(전체 기능 실사용 QA)에서 발견된 UI/환경 처리 계층(`src/ui/readline-engine.js`, `src/ui/ansi.js`, `src/ui/summary.js`, `src/ui/prompts.js`, `src/core/detect.js`)의 4가지 결함. 각각 독립적이지만 전부 "저수준 환경 처리가 문서화된 기대와 다르다"는 성격이라 이슈 하나로 묶여 있다. 개별 심각도는 낮지만 실사용 시 혼란을 유발할 수 있다.

- **L1/M11**: `readline-engine.js`에 `stdin.on("end", ...)` 핸들러가 없어 Ctrl+D/SSH 연결 끊김 등으로 stdin이 예기치 않게 끊기면 무한 대기할 수 있다.
- **L2**: `banner.js`(→`ansi.js` paint())는 무조건 색을 칠하고, `summary.js`는 `stderr.isTTY`만 체크한다 — `NO_COLOR`는 어디서도 확인하지 않아 같은 실행 안에서 화면 영역마다 처리가 다르다.
- **L3**: README가 문서화한 `status`/`doctor` 읽기 전용 모드가 대화형 최상위 메뉴(`prompts.js` selectMode)에는 노출되지 않는다.
- **L4**: `detect.js`의 `detectVersionFromFiles`가 이미 Node `JSON.parse`로 파싱을 마친 `package.json`의 `pkg.version`을, 실제로는 이 경로에 전혀 쓰이지 않는 `hasJq` 게이트 때문에 버리고 경고 없이 잘못된 값(`0.0.1`)으로 폴백한다.

## 2. 목표 / 비목표

**목표**: 4건 모두 이슈 본문의 "예상 동작"을 만족하도록 수정한다. 기존 아키텍처(엔진 di 패턴, io 주입, 순수 함수/실행부 분리)를 그대로 따르고 호출부 변경을 최소화한다.

**비목표**:
- 이슈 #11 QA 결과 문서의 다른 결함(M9, M10 등)은 이 이슈 범위 밖 — 별도 이슈로 다룬다.
- `readline-engine.js`와 `ansi.js`를 하나의 모듈로 합치지 않는다 — `readline-engine.js`의 "의존성 0, ansi.js와 독립" 설계 의도는 유지한다.
- `hasJq`/`hasCommand("jq")` 자체를 완전히 다른 목적(예: 실제 jq 필요한 향후 케이스)으로 남겨두지 않는다 — 현재 코드베이스에 jq가 실제로 필요한 지점이 없으므로 완전히 제거한다.

## 3. L1/M11 — stdin EOF(Ctrl+D) 처리

### 설계

`src/ui/readline-engine.js`의 두 지점에 `stdin.on("end", ...)` 리스너를 추가한다:

1. **`keySession(renderFn, onKey)`** — `select`/`multiselect`/`confirm`이 공유하는 raw keypress 래퍼(현재 79행 `stdin.on("keypress", handler)`).
2. **`text({ message, defaultValue })`** — 자체 raw 핸들러를 쓰는 별도 구현(현재 214행 `stdin.on("keypress", handler)`).

두 곳 모두 EOF 시:
- 기존 `cleanup()`을 호출해 리스너 해제·rawMode 복원·커서 복원을 동일하게 수행
- **`resolve(CANCEL)`** — ESC/Ctrl+C와 완전히 동일한 결과값

`cleanup()` 내부에서 `"end"` 리스너도 `removeListener`로 함께 정리한다(반대로 keypress 핸들러가 정상 종료될 때도 `"end"` 리스너가 계속 stdin에 남지 않도록).

### 왜 호출부를 건드릴 필요가 없는가

`interactive.js`를 비롯한 모든 호출부는 이미 CANCEL을 "안전하게 취소하고 정상 종료(exit 0)"로 처리하는 계약을 갖고 있다(`isCancel()` 체크, ESC 처리 루프 등). EOF를 CANCEL과 동일한 값으로 resolve하면 기존 계약을 그대로 타므로 `readline-engine.js` 내부 수정만으로 끝난다.

### 비TTY 경로는 영향 없음

`select`/`multiselect`/`text`/`confirm` 모두 `!stdin.isTTY`면 리스너를 아예 등록하지 않고 즉시 기본값을 반환하고 끝난다 — 이 경로는 애초에 EOF 대기 문제가 없으므로 변경 대상이 아니다.

## 4. L2 — NO_COLOR/비TTY 색상 처리 통일

### 설계

`src/ui/ansi.js`에 공용 가드를 추가한다:

```js
export function colorEnabled(stream = process.stdout) {
  return !process.env.NO_COLOR && !!stream.isTTY;
}
export function paint(s, color, enabled = colorEnabled()) {
  return enabled ? `${color}${s}${A.reset}` : String(s);
}
```

- `enabled` 인자를 생략하면 기존 `paint(s, color)` 호출부는 그대로 동작하되, 내부적으로 `NO_COLOR`/`stdout.isTTY`를 체크하게 된다.
- **부수 효과(무수정으로 해결)**: `src/ui/banner.js`, `src/ui/status-cards.js`는 이미 `ansi.js`의 `paint`를 그대로 사용하므로 시그니처 확장만으로 자동 수정된다. 특히 `status-cards.js`는 모듈 최상단에서 `paint()`를 즉시 호출해 상수를 만드는데(`const GUT = paint("│", A.gray)` 등), `process.stdout.isTTY`/`NO_COLOR`는 프로세스 시작 시점에 이미 고정되는 값이라 이 모듈이 언제 로드되든(대화형이든 아니든) 그 시점의 값이 프로세스 전체에서 유효한 최종값과 같다 — 모듈 로드 시점 평가가 문제되지 않는다.
- `src/ui/summary.js`는 자체 계산하던 `YELLOW`/`CYAN`/`NC`(현재 `stderr.isTTY`만 체크, `NO_COLOR` 미확인)를 제거하고 `ansi.js`의 `paint`/`colorEnabled`를 재사용하도록 리팩터링한다. `summary.js`는 항상 `stderr`에 쓰므로 `colorEnabled(process.stderr)`를 명시적으로 넘긴다.
- `src/ui/readline-engine.js`는 파일 헤더 주석에 명시된 "ansi.js와 독립적인 의존성 0 헬퍼" 설계를 존중해 **`ansi.js`를 import하지 않는다**. 대신 동일한 `NO_COLOR` + 대상 스트림(`stdout`) TTY 가드 로직을 파일 내부에 소규모로 복제한다. 동작은 통일되지만 파일 간 의존성은 늘리지 않는다.

## 5. L3 — 대화형 메뉴에 status/doctor 노출

### 설계

`src/ui/prompts.js`의 `selectMode()` choices 배열(현재 12~19행) 끝에 두 항목을 추가한다:

```js
{ value: "status", label: "설치 상태 확인 — 읽기 전용, 버전·타입·드리프트 확인" },
{ value: "doctor", label: "환경 진단 — 읽기 전용, gh CLI·권한·secret 설정 점검" },
```

`src/commands/interactive.js`의 `runInteractive()`에서 모드 선택 직후(`revert`/`uninstall` 분기와 같은 위치, breaking-check·감지 로직보다 앞)에 두 분기를 추가한다:

```js
if (mode === "status") {
  printStatus(runStatus(payload, cwd));
  return 0;
}
if (mode === "doctor") {
  printDoctorReport(runDoctor(cwd));
  return 0;
}
```

- `runStatus`/`printStatus`는 `../commands/status.js`(동일 디렉터리이므로 `./status.js`)에서, `runDoctor`/`printDoctorReport`는 `./doctor.js`에서 import한다.
- `--mode status`/`--mode doctor`(`src/index.js`)와 동일하게 outro 없이 즉시 종료한다 — 배너는 `runInteractive()` 최상단에서 이미 공통 출력되므로 별도 처리 불필요.
- io 스텁 테스트 호환을 위해 `printStatus`/`printDoctorReport`는 실제 구현을 직접 호출한다(다른 화면 출력처럼 `io.xxx?.()` 옵셔널 계약에 태우지 않는다 — status/doctor 결과 출력 자체가 이 두 모드의 핵심 동작이라 스텁으로 건너뛸 대상이 아님). 대신 `runStatus`/`runDoctor`가 받는 `payload`/`cwd`는 이미 `runInteractive()` 스코프에 있는 값을 그대로 사용한다.

## 6. L4 — jq 미설치 시 버전 감지 폴백

### 설계

**`src/core/detect.js`** — `detectVersionFromFiles`:

```js
export function detectVersionFromFiles({ read, readJson, gitTag, warn }) {
  const pkg = readJson?.("package.json");
  if (pkg?.version && VERSION_RE.test(pkg.version)) return pkg.version;
  // ... build.gradle / pubspec.yaml / pyproject.toml / gitTag 순서는 변경 없음 ...
  if (gitTag) { /* 기존과 동일 */ }
  warn?.("⚠️  버전을 자동 감지하지 못해 기본값 0.0.1을 사용합니다 — --project-version으로 직접 지정하거나 version.yml을 확인하세요.");
  return "0.0.1";
}
```

- 시그니처에서 `hasJq`를 제거한다 — jq는 이 함수 안에서 실제로 파싱에 쓰인 적이 없으므로(Node `JSON.parse`로 이미 끝남), package.json 케이스는 이제 항상 감지된다.
- 신규 `warn` 콜백(선택적 주입)을 마지막 하드코딩 폴백 직전에 호출한다 — build.gradle/pubspec.yaml/pyproject.toml grep과 git tag까지 전부 실패했을 때만 트리거되므로, "진짜 아무 단서도 없는" 상황에만 경고가 뜬다.

**`src/core/detect-fs.js`** — `detectVersion`:

```js
export function detectVersion(root, { warn = (m) => console.error(m) } = {}) {
  const read = readFile(root);
  const readJson = (rel) => { /* 기존과 동일 */ };
  const gitTag = gitOut(root, ["describe", "--tags", "--abbrev=0"]);
  return detectVersionFromFiles({ read, readJson, gitTag, warn });
}
```

- 더 이상 쓰이지 않는 `hasCommand("jq")` 헬퍼와 `hasJq` 배선을 제거한다(grep으로 다른 용도 사용처 없음을 확인 완료).
- `warn`은 기본값 `console.error`로 연결되므로 **`src/index.js`, `src/commands/interactive.js`의 `detectVersion(cwd)` 호출부는 전혀 수정할 필요가 없다** — 두 경로 모두 자동으로 경고를 받는다.
- 테스트에서는 `warn`을 스텁으로 주입해 호출 여부/메시지를 검증할 수 있다.

## 7. 테스트 전략

| 결함 | 테스트 방식 |
|---|---|
| L1 | `readline-engine.js`는 순수 `node:process`의 `stdin`을 직접 참조해 스트림 주입이 불가능하므로, 자식 프로세스를 spawn해 stdin을 pipe로 열고 쓰지 않은 채 `end()`로 닫아 CANCEL 상당의 결과(정상 종료, 무한 대기 없음)를 검증하는 통합 테스트가 필요하다. 구체적 스폰 방식/타임아웃 값은 계획 단계에서 확정. |
| L2 | `NO_COLOR=1`/비TTY 조합으로 `printBannerCompact`/`printSummary` 출력 문자열에 ESC(`\x1b`) 바이트가 없는지 검증(`tests/node/summary-output.test.js` 확장 또는 신규 파일). `colorEnabled()`의 단위 테스트(NO_COLOR 설정 시 false, TTY stream mock 시 true/false)도 추가. |
| L3 | `tests/node/interactive-mode-uninstall.test.js` 패턴을 따라 `runInteractive`에 `selectMode` 스텁이 `"status"`/`"doctor"`를 반환하도록 주입 → exit code 0, 부수효과(파일 변경) 없음, 콘솔 출력에 상태/진단 관련 문구 포함 검증. |
| L4 | `detectVersionFromFiles`를 직접 호출해 (a) `hasJq` 인자 없이도(또는 인자 자체가 사라졌으므로) `readJson`이 유효한 버전을 반환하면 그대로 쓰이는지, (b) 모든 폴백이 실패했을 때 `warn` 콜백이 정확히 1회, 기대 메시지로 호출되는지 검증. `detectVersion`(detect-fs.js)에도 `warn` 스텁 주입 테스트 추가. |

## 8. 변경 파일 목록

| 파일 | 변경 내용 |
|---|---|
| `src/ui/readline-engine.js` | `keySession()`/`text()`에 `stdin.on("end", ...)` → CANCEL resolve 추가, NO_COLOR/TTY 색상 가드 자체 복제 |
| `src/ui/ansi.js` | `colorEnabled(stream)` 신규, `paint()` 시그니처에 `enabled` 옵션 추가 |
| `src/ui/summary.js` | 자체 `YELLOW`/`CYAN`/`NC` 계산 제거 → `ansi.js`의 `paint`/`colorEnabled(process.stderr)` 재사용 |
| `src/ui/prompts.js` | `selectMode()` choices에 `status`/`doctor` 추가 |
| `src/commands/interactive.js` | `status`/`doctor` 모드 분기 추가 |
| `src/core/detect.js` | `detectVersionFromFiles`에서 `hasJq` 게이트 제거, `warn` 콜백 추가 |
| `src/core/detect-fs.js` | `detectVersion`에서 `hasCommand("jq")`/`hasJq` 배선 제거, `warn` 기본값(`console.error`) 연결 |
| `tests/node/*.test.js` | L1(신규 stdin EOF 테스트), L2(색상 가드 테스트 확장), L3(interactive status/doctor 분기 테스트), L4(jq 폴백/경고 테스트) |

## 9. 사용자 결정 사항 요약 (브레인스토밍 Q&A)

1. EOF 시 취소(CANCEL)와 동일하게 처리한다.
2. 색상 가드는 `ansi.js`에 공용으로 두고 단일 진실 공급원으로 삼는다.
3. `readline-engine.js`도 (의존성 0 유지한 채) 동일 가드를 적용한다.
4. jq 게이트는 완전히 제거하고, 최종 하드코딩 폴백 시에는 경고를 남긴다.
5. status/doctor는 실행 후 즉시 종료한다(메뉴로 되돌아가지 않음).
