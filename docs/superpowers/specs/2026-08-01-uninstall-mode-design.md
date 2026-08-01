# `--mode uninstall` 신설 — 대화형 체크리스트 기반 완전 삭제 지원

- 날짜: 2026-08-01
- 상태: 브레인스토밍 완료 (사용자 승인 대기 — 코드 구현 착수 전)
- 이슈: `#5` (`.issue/#20260728_002_기능추가_uninstall_모드_추가.md`)
- 브랜치: `20260801_#5_uninstall_신설_대화형_체크리스트_기반_완전_삭제_지원`
- 참고: 이 문서는 **설계 스펙**이다. 실제 구현 순서/작업 단위는 별도 `writing-plans` 세션에서 다룬다.

## 1. 배경 — 문제 정의

- `project-auto-wizard`는 사용자 프로젝트에 GitHub Actions 워크플로우, `.github/scripts/*.py`, `version.yml`, README 버전 섹션, `.gitignore` 항목, `.coderabbit.yaml`(opt-in) 등을 설치한다.
- 현재 `--mode revert`(`src/commands/revert.js`)는 payload 파일명과 **정확히 일치하는** 워크플로우·스크립트·`.coderabbit.yaml`만 제거하도록 의도적으로 보수적으로 설계되어 있다.
- README 자동 버전 섹션(`<!-- AUTO-VERSION-SECTION` 마커), `.gitignore` 자동 추가 항목(`project-auto-wizard: Auto-added entries` 배너), `version.yml`은 "사용자 데이터"로 간주되어 `revert`가 건드리지 않는다.
- 결과적으로 사용자가 마법사를 완전히 걷어내고 싶을 때 `revert` 실행 후에도 README·`.gitignore`에 흔적이 남아 수동 정리가 필요하다.

## 2. 스코프

- 기존 `--mode revert`는 **그대로 유지**(하위 호환, 코드 미변경). 별도 `--mode uninstall`을 신설한다.
- 대화형(TTY) 실행 시 체크리스트로 항목별 opt-in/opt-out을 받는다. 워크플로우/스크립트/coderabbit은 기본 체크, README/`.gitignore`/`version.yml`은 기본 비체크.
- 비대화형(`--force`) 실행 시에는 안전한 최소 삭제(워크플로우·스크립트·coderabbit)만 기본 적용하고, README·gitignore·version.yml 삭제는 `--purge-readme`/`--purge-gitignore`/`--purge-version` 플래그가 있을 때만 수행한다.
- `--dry-run`을 지원해 실제 삭제 전 무엇이 지워지는지 미리 보여준다.
- 대화형 최상위 마법사 메뉴(`무엇을 설치할까요?`)에도 "완전 삭제" 옵션을 추가해 `--mode uninstall`을 몰라도 도달 가능하게 한다.

## 3. 새 파일 / 변경 파일

| 파일 | 변경 내용 |
|---|---|
| `src/commands/uninstall.js` *(신규)* | `planUninstall`/`runUninstall`/`runUninstallFlow` |
| `src/core/copy/readme.js` | `removeVersionSectionFromReadme`, `hasVersionSection` 추가 |
| `src/core/copy/gitignore.js` | `removeAutoAddedEntriesFromGitignore`, `hasAutoAddedEntries` 추가 |
| `src/cli/args.js` | `--purge-readme`/`--purge-gitignore`/`--purge-version` 플래그 파싱 추가 |
| `src/index.js` | `opts.mode === "uninstall"` 분기 추가 (revert 분기와 나란히) |
| `src/ui/prompts.js` | `selectMode()`에 "완전 삭제" 옵션 추가 |
| `src/commands/interactive.js` | `mode === "uninstall"` 분기 추가 — `runUninstallFlow` 호출 |
| `src/commands/dry-run.js` | `planDryRun("uninstall", ...)` 지원 추가 |
| `src/cli/help.js`, `README.md` | 새 모드·플래그 문서화 |

`src/commands/revert.js`는 **수정하지 않는다.** uninstall은 `planRevert()`(읽기 전용, 순수 함수)만 재사용해 후보 목록을 얻고, 실제 삭제 루프는 `uninstall.js`에 별도로 작성한다 — `runRevert`의 시그니처를 바꾸면 기존 revert 경로/테스트에 영향이 갈 수 있기 때문이다.

## 4. CLI 흐름 (`index.js`) — 비대화형

`revert` 분기 바로 뒤에 `uninstall` 분기를 추가한다. 게이트는 기존 모드들과 동일한 원칙을 따른다:

```
if (opts.mode === "uninstall") {
  const safeSelection = { workflows: true, scripts: true, coderabbit: true,
                           readme: opts.purgeReadme, gitignore: opts.purgeGitignore, versionYml: opts.purgeVersion };

  if (opts.dryRun) {                         // --dry-run은 항상 게이트 우회 (기존 정책과 동일)
    printDryRun(planDryRun("uninstall", { uninstallSelection: safeSelection }, payload, cwd));
    return 0;
  }
  if (opts.force) {                          // --force: TTY 여부 무관, 체크리스트 없이 안전삭제+opt-in만
    const r = runUninstall({}, payload, cwd, safeSelection);
    ...결과 출력...
    return 0;
  }
  if (!process.stdout.isTTY) {               // 비대화형인데 --force도 없음 → 기존과 동일하게 에러
    console.error("비대화형 환경에서는 --force 옵션이 필요합니다.");
    return 1;
  }
  // TTY && !force → 대화형 체크리스트
  await runUninstallFlow(payload, cwd, prompts);
  return 0;
}
```

- `--force`가 있으면 `--purge-*` 플래그만 opt-in으로 반영되고 체크리스트는 절대 뜨지 않는다(스크립트/CI 안전성).
- `--force` 없이 TTY면 대화형 체크리스트로 넘어간다. 이 경로에서는 `--purge-*` 플래그는 무시된다(체크리스트 자체가 선택 수단이므로 혼선을 피한다).

## 5. 대화형 체크리스트 흐름 — `runUninstallFlow` (공유 함수)

`index.js`의 CLI TTY 경로와 `interactive.js`의 `mode === "uninstall"` 분기가 **동일한 함수**를 호출한다(중복 방지 + 테스트 가능성 확보 — `io` 주입 패턴은 기존 `runInteractive`와 동일):

```
export async function runUninstallFlow(payloadRoot, targetRoot, io) {
  // 1) 실제 존재하는 항목만 후보로 계산 (planRevert + hasVersionSection + hasAutoAddedEntries + version.yml 존재)
  const available = detectAvailableItems(payloadRoot, targetRoot);
  if (available.length === 0) {
    io.note?.("제거할 항목이 없습니다.", "완전 삭제");
    return null;
  }

  // 2) 체크리스트 — workflows/scripts/coderabbit 기본 체크, readme/gitignore/versionYml opt-in
  const checked = await io.engineIo.multiselect({
    message: "삭제할 항목을 선택하세요 (Space 토글, Enter 확정)",
    options: available,               // 존재하는 항목만 옵션으로 노출
    initialValues: available.map(o => o.value).filter(v => SAFE_DEFAULTS.has(v)),
  });
  if (isCancel(checked) || !checked?.length) { io.cancelMessage?.("완전 삭제를 취소했습니다."); return null; }

  // 3) 최종 확인 (기본 아니오 — revert와 동일한 안전 원칙)
  const selection = toSelection(checked);
  io.note?.(summarizeSelection(selection), "삭제 예정 항목");
  const ok = await io.askYesNo("정말 삭제할까요? 되돌릴 수 없습니다.", false);
  if (ok !== true) { io.cancelMessage?.("완전 삭제를 취소했습니다."); return null; }

  // 4) 실행
  const result = runUninstall({}, payloadRoot, targetRoot, selection);
  io.note?.(summarizeResult(result), "완전 삭제 완료");
  return result;
}
```

- `interactive.js`: `if (mode === "uninstall") { await runUninstallFlow(payload, cwd, io); io.outro?.("완전 삭제를 마쳤습니다."); return 0; }` — revert 분기와 같은 위치(Breaking Changes 게이트보다 앞)에 둔다. 감지/타입질문 전부 불필요.
- `prompts.js`의 `selectMode()`에 `{ value: "uninstall", label: "완전 삭제 — 마법사가 설치·수정한 모든 항목 제거(확인 후, README·gitignore·version.yml 포함)" }` 옵션 추가.

## 6. README / .gitignore / version.yml 제거 로직

**`readme.js` — `removeVersionSectionFromReadme(targetRoot)`**
- `addVersionSectionToReadme`가 항상 파일 **맨 끝**에 `"\n---\n\n<!-- AUTO-VERSION-SECTION..."` 블록을 추가한다는 사실을 그대로 역이용한다.
- MARKER 앞의 `"\n---\n\n"` 구분자 시작 위치부터 파일 끝까지를 잘라내고, 원래 파일이 개행으로 끝났는지 여부를 복원한다.
- 반환값: `'removed' | 'skip-no-readme' | 'skip-no-marker'` (기존 `addVersionSectionToReadme`의 반환 스타일과 대칭)
- `hasVersionSection(targetRoot)`: 존재 여부만 boolean으로 반환 (체크리스트 노출 판단용)

**`gitignore.js` — `removeAutoAddedEntriesFromGitignore(targetRoot)`**
- 두 가지 케이스를 구분한다:
  1. **파일이 원래 없었는데 마법사가 새로 만든 경우**: 현재 내용이 `NEW_FILE_CONTENT`와 **완전히 동일**하면 → 파일 자체를 삭제(원래 존재하지 않았으므로 통째로 되돌리는 게 맞음)
  2. **기존 파일에 배너 블록(`# project-auto-wizard: Auto-added entries`)이 추가된 경우**: 배너 3줄 + 그 뒤에 이어지는 `REQUIRED_ENTRIES` 라인들 + 블록 앞의 구분용 빈 줄만 제거하고, 그 이전 사용자 콘텐츠는 그대로 보존
  3. 둘 다 해당 없으면(배너도 없고 신규생성 콘텐츠도 아님) → no-op
- 반환값: `'removed' | 'file-deleted' | 'skip-no-gitignore' | 'skip-not-found'`
- `hasAutoAddedEntries(targetRoot)`: 위 1·2 케이스 중 하나라도 해당하면 true

**`version.yml`**: `fsutil.remove(join(targetRoot, PATHS.versionFile))`로 파일 전체 삭제. 별도 로직 불필요.

**`uninstall.js` — `planUninstall`/`runUninstall`**

```
export function planUninstall(payloadRoot, targetRoot, selection) {
  const revertPlan = planRevert(payloadRoot, targetRoot); // 읽기 전용 재사용
  return {
    workflows: selection.workflows ? revertPlan.workflows : [],
    scripts:   selection.scripts   ? revertPlan.scripts   : [],
    coderabbit: selection.coderabbit ? revertPlan.coderabbit : false,
    readme:    selection.readme    ? hasVersionSection(targetRoot) : false,
    gitignore: selection.gitignore ? hasAutoAddedEntries(targetRoot) : false,
    versionYml: selection.versionYml ? existsSync(join(targetRoot, PATHS.versionFile)) : false,
  };
}

export function runUninstall(context, payloadRoot, targetRoot, selection) {
  const plan = planUninstall(payloadRoot, targetRoot, selection);
  // workflows/scripts/coderabbit 제거 — runRevert 내부 로직과 동일한 방식(별도 작성, revert.js는 건드리지 않음)
  ...
  if (plan.readme) removeVersionSectionFromReadme(targetRoot);
  if (plan.gitignore) removeAutoAddedEntriesFromGitignore(targetRoot);
  if (plan.versionYml) remove(join(targetRoot, PATHS.versionFile));
  return plan;
}
```

## 7. `--dry-run` / `--help` / README 문서화

- **`dry-run.js`**: `planDryRun("uninstall", context, payloadRoot, targetRoot)` 추가 — `context.uninstallSelection`(§4의 `safeSelection` 형태)을 받아 `planUninstall()` 결과를 그대로 반환. `printDryRun`에 `mode === "uninstall"` 분기 추가해서 워크플로우/스크립트/coderabbit(revert와 동일 포맷) + README 섹션 여부·`.gitignore` 항목 여부·`version.yml` 여부를 라인으로 출력한다.
- **`help.js`**: `-m, --mode` 설명에 `uninstall` 추가, `--purge-readme`/`--purge-gitignore`/`--purge-version` 옵션 설명 추가, 예시에 `npx project-auto-wizard --mode uninstall --force --purge-readme --purge-gitignore --purge-version` 한 줄 추가.
- **`README.md`**: 기존 "되돌리기(`--mode revert`)" 절 바로 뒤에 "완전 삭제(`--mode uninstall`)" 절을 신설 — revert와의 차이(README/gitignore/version.yml까지 제거 가능, 대화형 체크리스트, `--force` 시 opt-in 플래그 필요)를 설명. 옵션 표에도 `uninstall` 모드와 `--purge-*` 플래그를 추가.

## 8. 테스트 계획

| 파일 | 내용 |
|---|---|
| `tests/node/readme-remove.test.js` *(신규)* | `removeVersionSectionFromReadme`: added→removed 왕복, 마커 없음, README 없음 |
| `tests/node/gitignore-remove.test.js` *(신규)* | `removeAutoAddedEntriesFromGitignore`: 신규생성 파일 삭제 케이스, 기존파일 배너제거 케이스, 배너 없음 no-op |
| `tests/node/uninstall-plan.test.js` *(신규)* | `planUninstall`/`runUninstall`: 전체 선택(=revert와 동일 파일 제거 + 3종 추가 제거), 부분 선택(일부만 체크), 아무것도 없을 때 |
| `tests/node/uninstall-cli.test.js` *(신규)* | `index.js`의 `--mode uninstall --force` (+`--purge-*` 조합) / `--dry-run` — `revert-plan.test.js`·`dry-run-cli.test.js` 패턴 재사용 |
| `tests/node/interactive-uninstall.test.js` *(신규)* | `runUninstallFlow`를 스텁 `io`로 호출 — 체크리스트 선택→확인→실행 흐름, 취소 시 미실행, 항목 없을 때 조기 종료 |

모든 새 테스트는 `node --test`로 기존 `npm run test:node`에 자동 포함된다.

## 9. 브레인스토밍 중 확정된 결정 사항 (요약)

1. **진입 경로**: CLI 플래그(`--mode uninstall`) + 대화형 최상위 메뉴 둘 다 지원 (옵션 B 채택).
2. **README/.gitignore 편집 시 백업**: `.bak` 백업 없이 바로 수정 (정규식/마커로 정확히 식별된 구간만 제거하므로 안전하다고 판단).
3. **version.yml purge**: 파일 전체 삭제.
4. **CLI 게이트**: `--force`=안전삭제+opt-in 플래그만 반영, TTY && !force=대화형 체크리스트, 비대화형 && !force=에러(기존과 동일).
5. **`.gitignore` 제거 로직**: 신규생성 파일은 통째로 삭제, 기존 파일은 배너 블록만 제거.

## 10. 관련 이슈 문서

- `.issue/#20260728_002_기능추가_uninstall_모드_추가.md` — 원본 이슈, 구현 가이드 포함.
