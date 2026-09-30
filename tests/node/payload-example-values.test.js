// tests/node/payload-example-values.test.js
// Prevents example values left in payload templates from being installed.
//
// This is a "code is fine but the installed result is wrong" problem, so other tests do not catch it.
// The same mistake recurs whenever a template is added or copied, so the payload itself is checked.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolvePayloadRoot } from "../../src/core/assets.js";
import { parseWizardLine } from "../../src/core/wizard-env.js";

const WF_ROOT = join(resolvePayloadRoot(), "workflows");

function allWorkflowFiles(dir = WF_ROOT, acc = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) allWorkflowFiles(p, acc);
    else if (/\.ya?ml$/.test(name)) acc.push(p);
  }
  return acc;
}

const rel = (p) => p.slice(WF_ROOT.length + 1);
const isCommented = (line) => /^\s*#/.test(line);

// Values that must not remain in installed files. Occurrences in comments (explanations, examples) are fine —
// only cases hard-coded as real env values are caught.
const FORBIDDEN = [
  { pattern: /"my-project"/, why: "example project name that fits no project" },
  { pattern: /sites-enabled\/example\.conf/, why: "example nginx config path — if wrong, zero-downtime switching does not work" },
  { pattern: /suhsaechan\.kr/, why: "original author's personal domain" },
  { pattern: /Suh-Web\//, why: "module name of the original author's project" },
  { pattern: /\/volume1\/project\//, why: "typo of /volume1/projects" },
  { pattern: /프로젝트명/, why: "Korean placeholder — installed verbatim as a value" },
];

test("payload workflow env values contain no example values or personal settings", () => {
  const hits = [];
  for (const file of allWorkflowFiles()) {
    readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
      if (isCommented(line)) return;
      for (const { pattern, why } of FORBIDDEN) {
        if (pattern.test(line)) hits.push(`${rel(file)}:${i + 1} — ${why}\n    ${line.trim()}`);
      }
    });
  }
  assert.deepStrictEqual(hits, [], `example values would be installed as is:\n  ${hits.join("\n  ")}`);
});

test("the target line of an @wizard ask marker must be a double-quoted value to be substituted", () => {
  // setEnvLine was widened to handle single quotes too, but template notation stays double-quoted —
  // if marker lines use inconsistent notation, substitution failures are hard to spot by eye.
  const bad = [];
  for (const file of allWorkflowFiles()) {
    readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
      const p = parseWizardLine(line);
      // A fallback marker line is a `${{ ... || 'literal' }}` expression, not a quoted value — only the last literal is substituted.
      if (!p || p.action === "fallback") return;
      if (!new RegExp(`^\\s*${p.key}:\\s*"`).test(line)) bad.push(`${rel(file)}:${i + 1}  ${line.trim()}`);
    });
  }
  assert.deepStrictEqual(bad, [], `the value notation on @wizard marker lines is not double-quoted:\n  ${bad.join("\n  ")}`);
});

test("the deploy workflow's JAVA_VERSION defaults to the project's detected toolchain value (@jdk)", () => {
  // With a fixed default of 21, a project on a different toolchain breaks its build when the user just presses Enter.
  const bad = [];
  for (const file of allWorkflowFiles()) {
    if (!rel(file).startsWith("spring/")) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const p = parseWizardLine(line);
      if (p?.key === "JAVA_VERSION" && p.arg !== "@jdk") bad.push(`${rel(file)}  ask:${p.arg}`);
    }
  }
  assert.deepStrictEqual(bad, [], `the JAVA_VERSION default is hard-coded:\n  ${bad.join("\n  ")}`);
});

test("spring DockerHub credential secret names do not differ between workflows", () => {
  // Only PR-PREVIEW used DOCKER_* for the same DockerHub account, forcing users to register two secret pairs.
  const bad = [];
  for (const file of allWorkflowFiles()) {
    if (!rel(file).startsWith("spring/")) continue;
    readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
      if (isCommented(line)) return;
      if (/secrets\.DOCKER_(USERNAME|PASSWORD)\b/.test(line)) bad.push(`${rel(file)}:${i + 1}`);
    });
  }
  assert.deepStrictEqual(bad, [], `must be unified to DOCKERHUB_USERNAME/DOCKERHUB_TOKEN:\n  ${bad.join("\n  ")}`);
});

test("spring workflows do not hard-code java-version as a literal", () => {
  // A Spring workflow had hard-coded java-version: '17' while omitting the @wizard marker
  // entirely. The JAVA_VERSION test above only inspects marker lines, so it could not
  // catch this marker-less case; hence the java-version lines themselves are scanned.
  const bad = [];
  for (const file of allWorkflowFiles()) {
    if (!rel(file).startsWith("spring/")) continue;
    readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
      if (isCommented(line)) return;
      if (/java-version:\s*['"0-9]/.test(line) && !/\$\{\{\s*env\.JAVA_VERSION\s*\}\}/.test(line)) {
        bad.push(`${rel(file)}:${i + 1}  ${line.trim()}`);
      }
    });
  }
  assert.deepStrictEqual(bad, [], `java-version is hard-coded as a literal (replace with an @wizard ask:@jdk marker):\n  ${bad.join("\n  ")}`);
});
