// 버전 비교: v 접두 제거, 3자리 숫자 비교, 누락 자리=0
export function compareVersions(a, b) {
  const parse = (v) => String(v).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pa = parse(a), pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

// breaking-changes.json에서 current < ver <= target 범위 항목 수집.
// target은 고정값이 아니라 실제 templateVersion을 넘긴다 — 그래야 설치하려는 버전까지의 고지가 모두 잡힌다.
// _ 로 시작하는 키(메타) 제외. severity critical / 그 외(warning).
// 버전 키의 값은 항목 객체 또는 항목 객체의 배열(같은 릴리스에 고지가 여러 건일 때).
// types: 설치된 프로젝트 타입. 항목에 types가 있으면 겹치는 타입이 있을 때만 보여준다 — spring 레포에
// Flutter 전용 경고가 뜨면 진짜 알려야 할 고지가 묻힌다. types를 모르면(빈 배열) 전부 보여준다.
export function collectBreaking(json, current, target, types = []) {
  const critical = [], warnings = [];
  const relevant = (entry) => !Array.isArray(entry?.types) || !types.length || entry.types.some((t) => types.includes(t));
  for (const [ver, value] of Object.entries(json || {})) {
    if (ver.startsWith("_")) continue;
    if (compareVersions(current, ver) < 0 && compareVersions(ver, target) <= 0) {
      // 한 릴리스에 고지가 여러 건이면 배열로 등록한다 — JSON 키(버전)는 유일해서 객체로는 한 건만 담긴다.
      for (const entry of Array.isArray(value) ? value : [value]) {
        if (!relevant(entry)) continue;
        const rec = { version: ver, ...entry };
        (entry?.severity === "critical" ? critical : warnings).push(rec);
      }
    }
  }
  return { critical, warnings };
}
