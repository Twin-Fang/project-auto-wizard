// .sh compare_versions 등가: v 접두 제거, 3자리 숫자 비교, 누락 자리=0
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
// ⚠️ .sh 버그 수정: target은 하드코딩 1.3.14가 아니라 실제 templateVersion을 넘긴다 (D2).
// _ 로 시작하는 키(메타) 제외. severity critical / 그 외(warning).
// 버전 키의 값은 항목 객체 또는 항목 객체의 배열(같은 릴리스에 고지가 여러 건일 때).
export function collectBreaking(json, current, target) {
  const critical = [], warnings = [];
  for (const [ver, value] of Object.entries(json || {})) {
    if (ver.startsWith("_")) continue;
    if (compareVersions(current, ver) < 0 && compareVersions(ver, target) <= 0) {
      // 한 릴리스에 고지가 여러 건이면 배열로 등록한다 — JSON 키(버전)는 유일해서 객체로는 한 건만 담긴다.
      for (const entry of Array.isArray(value) ? value : [value]) {
        const rec = { version: ver, ...entry };
        (entry?.severity === "critical" ? critical : warnings).push(rec);
      }
    }
  }
  return { critical, warnings };
}
