// Verifies the per-language READMEs keep the same structure and language switcher line.
// If README.md (English) changes and a translation is missed, this fails.
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

// The current language is bold; the others link to their README.
const langBar = (current) => LANGS.map(({ file, label }) => (file === current ? `**${label}**` : `[${label}](${file})`)).join(" · ");

// # comments inside code blocks are not headings, so only H2s are counted.
const h2Count = (text) => text.replace(/```[\s\S]*?```/g, "").split("\n").filter((l) => l.startsWith("## ")).length;
const anchors = (text) => [...text.matchAll(/<a id="([^"]+)"><\/a>/g)].map((m) => m[1]);

const base = read("README.md");

for (const { file } of LANGS) {
  const text = read(file);

  test(`${file}: has a language switcher line of the same format at the top`, () => {
    assert.ok(text.split("\n").slice(0, 5).includes(langBar(file)), `${file} needs the '${langBar(file)}' line at the top`);
  });

  test(`${file}: H2 section count, anchors, and code block count match README.md`, () => {
    assert.strictEqual(h2Count(text), h2Count(base), "H2 section count differs from README.md");
    assert.deepStrictEqual(anchors(text), anchors(base), "HTML anchors differ from README.md");
    assert.strictEqual((text.match(/^```/gm) || []).length, (base.match(/^```/gm) || []).length, "code block count differs from README.md");
  });

  test(`${file}: has the demo GIF and the docs site link`, () => {
    assert.ok(text.includes("https://raw.githubusercontent.com/Twin-Fang/project-auto-wizard/main/assets/demo/install.gif"));
    assert.ok(text.includes("https://twin-fang.github.io/project-auto-wizard/"));
  });
}

// The auto-updated version section lives only in README.md (workflows and the wizard handle only README.md).
test("the AUTO-VERSION-SECTION marker exists only in README.md", () => {
  assert.ok(base.includes("AUTO-VERSION-SECTION"));
  for (const { file } of LANGS.slice(1)) {
    assert.ok(!read(file).includes("AUTO-VERSION-SECTION"), `${file} must not have the auto-update marker`);
  }
});
