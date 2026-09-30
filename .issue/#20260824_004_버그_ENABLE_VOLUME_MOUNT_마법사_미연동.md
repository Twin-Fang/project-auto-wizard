<!-- GitHub Issue: #111 | https://github.com/Twin-Fang/project-auto-wizard/issues/111 -->
❗[버그][배포] ENABLE_VOLUME_MOUNT가 마법사에서 질문되지 않고 항상 false로 고정 설치됨

무슨 일이 있었나요?
---

`npx project-auto-wizard`로 go 프로젝트에 단일 서버 배포(SIMPLE-CICD)를 설치하면서, 마법사가 "호스트(NAS) 볼륨 경로"·"컨테이너 내부 마운트 경로" 질문에 값을 입력받아 반영해줬습니다. 하지만 설치된 `PROJECT-GO-SIMPLE-CICD.yaml`을 열어보면 실제 볼륨 마운트 스위치인 `ENABLE_VOLUME_MOUNT`가 아래처럼 항상 `"false"`로 설치되어 있습니다.

```yaml
ENABLE_VOLUME_MOUNT: "false"
VOLUME_HOST_PATH: "/volume1/project/claude-window-keeper"
VOLUME_CONTAINER_PATH: "/mnt/claude-window-keeper"
```

배포 스크립트 로직상 `ENABLE_VOLUME_MOUNT == "true"`일 때만 `docker run`에 볼륨 옵션이 들어가므로, 마법사가 물어봐서 받은 `VOLUME_HOST_PATH` / `VOLUME_CONTAINER_PATH` 값은 사용자가 직접 워크플로우 YAML에서 `ENABLE_VOLUME_MOUNT`를 `"true"`로 수동으로 바꾸지 않는 한 배포에 전혀 반영되지 않습니다. 설치 완료 화면의 "⚠️ 다음 작업을 확인해주세요" 체크리스트에도 이를 알리는 안내가 없어, 사용자가 이 사실을 알아채기 어렵습니다.

기대했던 동작
---

아래 둘 중 하나는 되어야 한다고 생각합니다.
- 마법사가 `ENABLE_VOLUME_MOUNT` 자체를 (이슈 생성 시 브랜치 자동 생성 질문처럼) boolean 질문으로 물어봐서, 볼륨 경로를 입력한 사용자의 의도대로 켜지거나
- 최소한 완료 화면의 "다음 작업을 확인해주세요" 체크리스트에 "볼륨 마운트를 쓰려면 ENABLE_VOLUME_MOUNT를 true로 바꾸세요"라는 안내가 있어야 합니다.

실행한 명령어
---

npx project-auto-wizard

project-auto-wizard 버전
---

v0.6.0

OS
---

macOS

🔍 원인 분석 및 수정 방향
---

- 원인: 아래 워크플로우 템플릿들의 `ENABLE_VOLUME_MOUNT: "false"` 라인에는 `@wizard ask` / `auto` 마커가 전혀 붙어있지 않아, 마법사 스캔 대상(`src/ui/env-plan.js`의 `collectAsks()`)에 아예 포함되지 않습니다. 반면 같은 파일의 `VOLUME_HOST_PATH` / `VOLUME_CONTAINER_PATH`에는 `@wizard ask` 마커가 붙어있어 질문 대상이 됩니다. `src/` 전체를 검색해도 `ENABLE_VOLUME_MOUNT`를 참조하는 로직이 없어(완료 화면 체크리스트 포함), 이 스위치를 사용자에게 안내하는 경로가 없는 상태입니다.
- 영향받는 워크플로우 템플릿:
  - `payload/workflows/go/PROJECT-GO-SIMPLE-CICD.yaml:77`
  - `payload/workflows/python/PROJECT-PYTHON-SIMPLE-CICD.yaml:77`
  - `payload/workflows/spring/server-deploy/PROJECT-SPRING-SIMPLE-CICD.yaml:101`
  - `payload/workflows/spring/server-deploy/PROJECT-SPRING-NONSTOP-NGINX-CICD.yaml:109`
  - `payload/workflows/spring/server-deploy/PROJECT-SPRING-NONSTOP-TRAEFIK-CICD.yaml:102`
- 수정 방향(추정): `src/ui/env-plan.js`의 `isBooleanDefault()`는 기본값이 정확히 `"true"`/`"false"`인 경우 boolean 필드로 자동 처리하므로(이슈 헬퍼의 `ISSUE_HELPER_CREATE_BRANCH`가 동일 패턴), 위 5개 파일의 `ENABLE_VOLUME_MOUNT: "false"`에 `# @wizard ask:false` 형태의 마커를 추가하고 `payload/config/wizard-prompts.yml`에 라벨/설명을 추가하면 UI 쪽은 기존 boolean 질문 로직을 그대로 재사용할 수 있을 것으로 보입니다. 다만 이 방식이 아니라면 최소한 `src/ui/summary.js`의 완료 체크리스트에 안내 문구를 추가하는 방향도 가능해 보입니다 — 정확한 결정은 담당자 판단이 필요합니다.

🙋‍♂️ 담당자
---

- **백엔드**: 이름
- **프론트엔드**: 이름
- **디자인**: 이름
