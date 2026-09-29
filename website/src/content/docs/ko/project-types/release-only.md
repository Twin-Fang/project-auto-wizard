---
title: Node, React Native, Expo, basic
description: 릴리스 자동화만 설치되는 타입.
---

이 타입들은 [릴리스 자동화](../common/)만 설치되고 타입 전용 CI/CD는 없습니다. 빌드·배포 워크플로우는 설치된 파일 옆에 직접 추가해 확장하세요.

| 타입 | 감지 기준 | 버전 동기화 파일 |
|---|---|---|
| `node` | `react`, `next`, `react-native`, `expo` 의존성이 없는 `package.json`, 다른 타입이 없을 때 | `package.json` |
| `react-native` | `react-native` 의존성이 있는 `package.json` | `Info.plist`, `build.gradle` |
| `react-native-expo` | `expo` 의존성이 있는 `package.json` | `app.json` |
| `basic` | 다른 타입에 해당하지 않을 때 | `version.yml`만 |

이 타입들에는 `--deploy-style`이 적용되지 않습니다.

## 패키지 배포

릴리스 흐름은 태그와 GitHub Release에서 끝납니다. npm 등 레지스트리에 배포하려면 Release 이벤트에서 도는 워크플로우를 추가하세요:

```yaml
on:
  release:
    types: [published]
```

그 워크플로우에서 릴리스 태그를 체크아웃하면 릴리스된 내용 그대로 배포됩니다. 이 레포도 npm 배포를 이렇게 합니다.

`GITHUB_TOKEN`으로 만든 Release는 다른 워크플로우를 트리거하지 않으므로 `RELEASE-PUBLISH`용 `WORKFLOW_PAT`을 등록해야 합니다. [릴리스 흐름](../../understand/release-flow/#패키지-배포)을 참고하세요.
