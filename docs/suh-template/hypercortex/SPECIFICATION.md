# SPECIFICATION.md

## 1. 개요 및 목적
본 사양서는 `.github/workflows/NPM-PUBLISH.yaml` 파일 내에서 `--provenance` 플래그를 영구 제거하여 배포 호환성을 확보하고, 기존 Classic Token(`NPM_TOKEN`)을 활용한 완결된 무결성 최초 및 지속 배포 흐름을 정의한다.

## 2. 파일 변경 사양 (Surgical Target)

### 대상 파일
* 경로: `.github/workflows/NPM-PUBLISH.yaml`

### 세부 변경 내역
```yaml
# AS-IS (기존 코드)
      - name: npm 배포
        if: steps.check.outputs.skip == 'false'
        run: npm publish --provenance --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

# TO-BE (수정 코드)
      - name: npm 배포
        if: steps.check.outputs.skip == 'false'
        run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

---

## 3. 배포 데이터 흐름 (ASCII Diagram)

```
[개발자: git push origin main]
              │
              ▼
┌──────────────────────────────────────────────┐
│ GitHub Actions 워크플로우 (NPM-PUBLISH) 실행   │
└─────────────┬────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────┐
│ version.yml 파일에서 타겟 배포 버전 추출      │
│ (예: v0.1.2)                                 │
└─────────────┬────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────┐
│ package.json에 버전 세팅                     │
│ (npm pkg set version=0.1.2)                  │
└─────────────┬────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────┐
│ 중복 배포 여부 체크 (npm view 활용)          │
└─────────────┬────────────────────────────────┘
              │
              ├─► [이미 등록됨 (skip=true)] ──► [성공 종료 (배포 스킵)]
              │
              └─► [새로운 버전 (skip=false)]
                      │
                      ▼
        ┌──────────────────────────────────────────────┐
        │ npm publish --access public 실행              │
        │ - GITHUB_ACCESS_TOKEN (Classic Token) 주입    │
        │ - '--provenance' (서명 옵션) 배제             │
        └─────────────────────┬────────────────────────┘
                              │
                              ▼
        ┌──────────────────────────────────────────────┐
        │ npmjs.org 레지스트리에 패키지 등록 성공 완료 │
        └──────────────────────────────────────────────┘
```

---

## 4. [REVIEW_LOG]
* **리뷰어 사양 검증**:
  * **사양의 단순성 및 안전성**: 변경 대상이 단 1줄(`--provenance` 제거)로 제한되어 있어 부작용(Side-effect) 및 회귀 오류 가능성이 극도로 낮습니다.
  * **검증 계획의 타당성**: `--provenance` 제거 후 워크플로우를 즉시 재수행하여 실제 성공 상태(`completed` / `success`)를 검증하는 절차를 테스트 단계에 포함해야 합니다.
  * **인증서 및 권한 격리성**: `secrets.NPM_TOKEN`은 환경변수 `NODE_AUTH_TOKEN`을 통해서만 노출되며, 로그에 노출되지 않도록 마스킹 처리되므로 보안 무결성이 유지됩니다.
