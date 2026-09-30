// 한국어 메시지: core 영역 (2부).
export default {
  "core.breakingCheck.confirm": "위 호환성 변경을 확인했고 계속 진행할까요?",
  "core.versionYml.pathMergedTitle": "타입당 폴더 하나",
  "core.versionYml.pathMerged": "version.yml 에 '{name}'(폴더 {path})과 '{type}'(폴더 {kept})이 따로 적혀 있지만 이제 같은 타입이라 타입당 폴더 하나만 관리합니다. {type}={kept} 를 유지하고, {path} 는 CI·버전 동기화에서 빠집니다.",
  "core.versionYml.pathMergedHint": "{path} 를 대신 관리하려면 --paths {type}={path} 로 다시 실행하세요. 둘 다 유지하려면 빠진 폴더용 CI 워크플로우를 직접 추가하세요.",
  "core.breakingCheck.nonInteractive": "⚠️  CRITICAL 호환성 변경이 있습니다 — 비대화형 실행이라 계속 진행합니다. 위 내용을 꼭 확인하세요.",
  "core.logger.error.nameExhausted": "로그 파일 이름이 모두 사용 중입니다: {base}",
  "core.logger.warn.startFailed": "실행 로그를 시작하지 못했습니다: {message}",
  "core.logger.warn.writeStopped": "실행 로그 기록을 중단합니다: {message}",
  "core.logger.summary.title": "=== 요약 ===",
  "core.removalExec.readmeSection": "README.md 버전 섹션",
  "core.verify.eitherSep": " 또는 ",
  "core.versionYml.error.templateRequired": "version.yml.template 원문이 필요합니다 (payload/version.yml.template 누락?)",
  "core.versionYml.error.unknownPlaceholder": "version.yml.template에 알 수 없는 플레이스홀더: {{{name}}}",
  "core.versionYml.pathsComment": "타입별 프로젝트 폴더 (레포 루트 기준 상대경로)",
  "core.versionYml.deployComment": "마법사가 기억하는 배포 설정 (비민감 / 직접 수정 가능)",
};
