// 언어별 README가 같은 구조와 언어 전환 줄을 유지하는지 확인한다.
// README.md(영어)를 바꾸고 번역본을 놓치면 여기서 걸린다.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");

const LANGS = [
  { file: "README.md", label: "English" },
  { file: "README.ko.md", label: "한국어" },
  { file: "README.zh-CN.md", label: "简体中文" },
  { file: "README.ja.md", label: "日本語" },
];

// 현재 언어는 굵게, 나머지는 해당 README로 링크한다.
const langBar = (current) => LANGS.map(({ file, label }) => (file === current ? `**${label}**` : `[${label}](${file})`)).join(" · ");

// 코드 블록 안의 # 주석은 제목이 아니므로 제외하고 H2만 센다.
const h2Count = (text) => text.replace(/```[\s\S]*?```/g, "").split("\n").filter((l) => l.startsWith("## ")).length;
const anchors = (text) => [...text.matchAll(/<a id="([^"]+)"><\/a>/g)].map((m) => m[1]);

const base = read("README.md");

for (const { file } of LANGS) {
  const text = read(file);

  test(`${file}: 상단에 같은 형식의 언어 전환 줄이 있다`, () => {
    assert.ok(text.split("\n").slice(0, 5).includes(langBar(file)), `${file} 상단에 '${langBar(file)}' 줄이 필요하다`);
  });

  test(`${file}: README.md와 H2 섹션 수·앵커·코드 블록 수가 같다`, () => {
    assert.strictEqual(h2Count(text), h2Count(base), "H2 섹션 수가 README.md와 다르다");
    assert.deepStrictEqual(anchors(text), anchors(base), "HTML 앵커가 README.md와 다르다");
    assert.strictEqual((text.match(/^```/gm) || []).length, (base.match(/^```/gm) || []).length, "코드 블록 수가 README.md와 다르다");
  });

  test(`${file}: 데모 GIF와 문서 사이트 링크가 있다`, () => {
    assert.ok(text.includes("https://raw.githubusercontent.com/Twin-Fang/project-auto-wizard/main/assets/demo/install.gif"));
    assert.ok(text.includes("https://twin-fang.github.io/project-auto-wizard/"));
  });
}

// 자동 갱신되는 버전 섹션은 README.md에만 둔다 (워크플로우와 마법사가 README.md만 다룬다).
test("AUTO-VERSION-SECTION 마커는 README.md에만 있다", () => {
  assert.ok(base.includes("AUTO-VERSION-SECTION"));
  for (const { file } of LANGS.slice(1)) {
    assert.ok(!read(file).includes("AUTO-VERSION-SECTION"), `${file}에는 자동 갱신 마커를 두지 않는다`);
  }
});
