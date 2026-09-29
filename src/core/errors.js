// 사용자 입력 오류 — 호출부(index.js)가 스택 없이 메시지만 출력하고 exit 1로 끝낸다.
// core 모듈도 던지므로 cli가 아닌 core에 둔다(core → cli 역참조 방지).
export class CliError extends Error {}
