# truncate_release_notes 스크립트 추가 — 설계 스펙

- 날짜: 2026-08-10
- 상태: 사용자 승인된 설계 (브레인스토밍 완료, fable 모델 1차 검토 반영)
- 관련 이슈: [Twin-Fang/project-auto-wizard#51](https://github.com/Twin-Fang/project-auto-wizard/issues/51)
- 트래킹 상위 이슈: #37

## 1. 배경 / 문제

Flutter 배포 워크플로우 3개가 `.github/scripts/truncate_release_notes.sh`를 호출하는데, 이 스크립트가 `payload/scripts/`에 존재하지 않는다. 호출부는 스토어 업로드 직전 단계에 있어 `set -e` 하에서 `bash <없는 파일>` → `exit 127`로 배포가 중단된다.

호출부 3곳 (전부 동일 계약: `<파일> <한도> <char|byte>`):

| 워크플로우 | 한도 | 모드 |
|---|---|---|
| `payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml` | 480 | char |
| `payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml` | 4000 | char |
| `payload/workflows/flutter/PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml` | 3800 | byte |

세 호출부 모두 스크립트 실행 전에 이미 `if [ -f ... ]` 가드로 파일 존재를 확인하고 있다.

## 2. 근본 원인 (표면적 원인 + 실제 원인)

1. **표면적 원인**: 스크립트 파일 자체가 저장소에 없음 (npm 패키지에 미포함).
2. **실제 원인 (설치 파이프라인)**: `package.json`의 `files` 필드는 `payload/` 전체를 npm 패키지에 포함하므로, 파일만 추가하면 npm 패키지에는 실린다. 하지만 사용자 레포로의 **설치**는 `src/core/copy/simple.js`의 `copyScripts()`가 `["version_manager.py", "changelog_manager.py"]`라는 하드코딩된 배열을 순회하는 방식이라, 이 배열에 항목을 추가하지 않으면 payload에 파일이 있어도 사용자의 `.github/scripts/`에 설치되지 않는다. 즉 이슈 제목대로 파일만 추가하는 것은 **부분적 수정**이며, 실제 배포 실패는 고쳐지지 않는다.

## 3. 결정: 구현 언어 — Python (bash 아님)

이슈는 `truncate_release_notes.sh`(bash)를 요청하지만, 이 저장소의 `docs/DESIGN-SPEC.md` §2는 다음을 명시한다:

> "스크립트는 전부 Python (sh 금지 — Windows 로컬 테스트 가능, ubuntu 러너 python3 기본 탑재, bash 3.2/BSD 크로스플랫폼 함정 소멸)"

또한 `CONTRIBUTING.md`는 `payload/scripts/`를 stdlib-only Python 전용 디렉토리로 규정하고, `tests/node/payload-yaml.test.js`에는 이미 `payload/` 내 `.sh` 참조를 금지하는 가드 테스트가 존재한다. 과거 `version_manager.sh`(bash)도 동일한 이유로 `version_manager.py`로 재작성되어 대체된 전례가 있다(`tests/py/test_sh_equivalence.py`가 그 증거).

**결정**: `payload/scripts/truncate_release_notes.py`로 구현한다. 워크플로우 3곳의 호출부를 `bash ".../truncate_release_notes.sh" ...` → `python3 ".../truncate_release_notes.py" ...`로 함께 변경한다 (각 1줄, 기존 `python3 .github/scripts/*.py` 호출 관례와 동일).

부수 효과: 이슈가 경고한 "`wc -m`이 non-UTF-8 로케일에서 한글 파일에 0을 반환" 함정은 Python을 선택함으로써 애초에 발생하지 않는다 (Python 문자열은 로케일과 무관하게 유니코드 코드포인트 단위). byte 모드의 멀티바이트 경계 처리도 `bytes.decode(errors="ignore")`로 단순하게 해결된다 (bash처럼 뒤에서부터 디코딩 가능 지점을 수동 탐색할 필요 없음).

## 4. 스크립트 계약

```
truncate_release_notes.py <파일> <한도:int> <char|byte>
```

- **파일 없음** → 아무 것도 하지 않고 exit 0 (배포를 막지 않음).
- **한도 이하** → 파일을 그대로 두고 exit 0.
- **한도 초과** → 파일을 제자리에서 한도까지 잘라 덮어쓰고 exit 0. 잘림 표시(`...` 등)는 추가하지 않는다 (이슈 계약에 없음).
- **인자 개수/타입/모드 오류** → `argparse` 표준 처리로 위임 (exit 2 — `version_manager.py`와 동일 관례, 커맨드라인 파싱 단계의 오류는 별도로 감싸지 않는다). **`한도 <= 0`**은 파싱 이후의 비즈니스 검증으로 별도 처리해 exit 1 (`version_manager.py`의 `validate_version()` 실패 패턴과 동일). 두 경우 모두 호출자(워크플로우 작성자) 버그이므로 실패를 드러낸다 — 파일 없음/인코딩 문제 같은 런타임 조건과는 구분.
- **원본 파일이 UTF-8이 아니어도** 죽지 않는다 — strict 디코드 금지, `errors="replace"`로 읽는다 (릴리스 노트 헬퍼가 배포를 막는 것은 본말전도라는 이슈의 원칙을 그대로 따름).
- **개행 보존**: 이 저장소는 `version_manager.py`에서 LF/CRLF 보존을 테스트로 계약화하고 있다 (`test_lf_file_stays_lf_after_set` 등). 동일하게 `newline=""`로 읽고 써서 개행 변환을 방지한다.
- **byte 모드 truncation**: `text.encode("utf-8")[:limit].decode("utf-8", errors="ignore")` — 잘린 끝의 불완전한 멀티바이트 시퀀스는 자동으로 버려지고, 재인코딩 결과는 항상 `limit` 바이트 이하임이 보장된다.
- **char 모드 truncation**: `text[:limit]` — Python 문자열은 코드포인트 단위이므로 로케일 문제가 없다.
- 콘솔 인코딩이 non-UTF-8이어도 안내 메시지 출력이 죽지 않도록 `sys.stdout.reconfigure(errors="replace")` (및 stderr 동일)를 적용한다 (이슈가 명시적으로 요청한 방어 코드). 출력 메시지 자체는 최소화한다.

## 5. 변경 파일 범위

**신규**
- `payload/scripts/truncate_release_notes.py`

**워크플로우 호출부 변경 (bash → python3, 각 1줄)**
- `payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-PLAYSTORE-CICD.yaml`
- `payload/workflows/flutter/PROJECT-FLUTTER-ANDROID-FIREBASE-CICD.yaml`
- `payload/workflows/flutter/PROJECT-FLUTTER-IOS-TESTFLIGHT.yaml`

**설치 파이프라인 (하드코딩 배열에 세 번째 항목 추가)**
- `src/core/copy/simple.js` — `copyScripts()`의 `scripts` 배열
- `src/core/removal-plan.js` — `planRemoval()`의 제거 대상 판별 배열 (`uninstall.js`·`purge.js`는 이 함수에서 파생되므로 별도 수정 불필요 — 확인됨. 참고: 이 파일은 원래 `src/commands/revert.js`였으나 revert 모드가 issue #70로 제거되며 core로 이동함)
- `src/ui/summary.js` — 설치 완료 후 출력하는 스크립트 목록 텍스트
- `src/core/paths.js` — 주석 (`*.py` 목록 언급)

**테스트**
- `tests/py/` 신규 테스트 파일 (`test_truncate_release_notes.py`): char/byte 모드, 한도 이하 통과, 파일 없음 무동작, 멀티바이트 경계, LF/CRLF 보존, `limit <= 0` 거부, 비 UTF-8 입력에서도 exit 0, 멱등성(이미 잘린 파일 재실행)
- `tests/node/assets.test.js` — `assert.strictEqual(copied, 2)`를 `3`으로 수정 (누락 시 CI 깨짐) + 신규 스크립트 설치 확인 assertion 추가
- `tests/node/payload-yaml.test.js` — `"no .sh script references in payload"` 테스트는 현재 `version_manager.sh` 문자열 하나만 검사한다. 동일한 스타일로 `truncate_release_notes.sh` assertion을 추가한다 (회귀 영구 차단, 기존 관례 그대로 유지 — 정규식 일반화 등 별도 리팩터링은 하지 않는다)

**범위 밖으로 확인됨** (fable 검토로 확정)
- `src/commands/uninstall.js`의 라벨 텍스트(`"스크립트 (.github/scripts/*.py)"`)는 Python 선택 시 그대로 정확 — 수정 불필요
- `tests/node/{purge-plan,purge-cli,uninstall-plan,uninstall-cli,uninstall-flow,interactive-mode-uninstall,dry-run-cli,removal-plan,e2e-matrix}.test.js` — 전부 포함/존재 검증만 하고 개수 검증이 없어 영향 없음 (fable 검토 시점 파일명 `revert-plan.test.js`는 이후 `removal-plan.test.js`로 리네임됨 — main 동기화로 확인)
- README.md mermaid 다이어그램 등 문서 언급은 배포 실패와 무관한 선택 사항 (여유가 되면 갱신)

## 6. 테스트 전략

- Python 테스트(`tests/py/test_truncate_release_notes.py`)는 기존 `test_version_manager.py`와 동일하게 `unittest` + 임시 디렉토리 + subprocess로 스크립트를 직접 실행하는 방식을 따른다.
- 콘솔 인코딩 방어(`sys.stdout.reconfigure`)는 `PYTHONIOENCODING=ascii` 환경변수로 subprocess를 띄워, 비 ASCII 메시지를 출력하는 경로에서도 exit 0인지 검증한다.
- Node 테스트는 `copyScripts`/`revert`/`summary` 관련 기존 스위트에 최소 변경만 가한다 (범위 밖 항목은 건드리지 않는다).

## 7. 브랜치 전략

`main`에서 이슈 브랜치를 분기하고 PR도 `main`으로 올린다 (`CONTRIBUTING.md` 문서상 명시는 "develop"이지만, 실제 관례와 기존 PR들은 전부 main 기준 — 이 저장소의 실관례를 따른다. 문서-실제 불일치 자체는 이번 작업 범위 밖).
