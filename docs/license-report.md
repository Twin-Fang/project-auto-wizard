# 의존성 라이선스 리포트

생성일: 2026-07-28

## npm (Node.js)

`package.json`에 런타임 `dependencies`와 `devDependencies`가 모두 0개입니다(zero-dependency 설계 원칙).

실행 환경(npm 11.9.0 / Node 24.14.0)에서 `npx -y license-checker --production --summary`를 그대로 실행하면 `npx`의 인자 파싱 방식 때문에 `license-checker`가 npm 서브커맨드로 오인되어 `Unknown command: "license-checker"` 오류가 발생했습니다. 동일한 스캔을 `npm exec --yes -- license-checker --production --summary` (`--` 구분자로 npm 자체 옵션과 대상 패키지 인자를 분리)로 재실행하여 정상적으로 스캔했습니다.

```
$ npm exec --yes -- license-checker --production --summary
└─ MIT: 1
```

```
$ npm exec --yes -- license-checker --production
└─ project-auto-wizard@0.1.6
   ├─ licenses: MIT
   ├─ repository: https://github.com/Twin-Fang/project-auto-wizard
   ├─ path: /Users/chuseok22/Workspace/contests/open-soruce/code/project-auto-wizard
   └─ licenseFile: /Users/chuseok22/Workspace/contests/open-soruce/code/project-auto-wizard/LICENSE
```

스캔에서 발견된 유일한 패키지는 프로젝트 자기 자신(`project-auto-wizard`, MIT)이며, 이는 서드파티 런타임 의존성이 0개임을 실측으로 확인합니다.

## Python (`payload/scripts/`)

`pip-licenses`를 이 환경에 설치하려는 시도(`pip install pip-licenses`, `pip3 install pip-licenses`)는 macOS 시스템 Python의 외부 패키지 설치 제한(`uv` 가상환경 필요)으로 실패했습니다. 대신 `payload/scripts/*.py`의 import 구문을 직접 확인했습니다.

```
$ grep -rnE "^import |^from " payload/scripts/*.py
changelog_manager.py: argparse, html, json, os, re, sys, traceback, urllib.error, urllib.request
version_manager.py:   argparse, datetime, json, os, re, sys, pathlib
```

`version_manager.py`/`changelog_manager.py`는 모두 Python 표준 라이브러리만 사용합니다(`argparse`, `json`, `re`, `urllib.request` 등). 외부 PyPI 패키지 의존성이 없습니다.

## 결론

이 프로젝트는 런타임 의존성이 0개이므로 서드파티 라이선스 충돌 리스크가 없습니다. `LICENSE` 파일(MIT)만이 이 저장소에 적용되는 라이선스입니다.
