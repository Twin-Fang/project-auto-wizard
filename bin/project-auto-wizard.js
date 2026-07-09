#!/usr/bin/env node
// project-auto-wizard CLI 엔트리 — argv를 src/index.js의 run()에 넘긴다.
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 20 || (nodeMajor === 20 && nodeMinor < 12)) {
  console.error(`Node.js 20.12 이상이 필요합니다 (현재: ${process.versions.node})`);
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const indexPath = join(here, "..", "src", "index.js");
const { run } = await import(pathToFileURL(indexPath).href);

const code = await run(process.argv.slice(2), { cwd: process.cwd() });
// process.exit() 금지 — fetch(undici) keep-alive 소켓·타이머와 경합해
// Windows libuv assertion(src/win/async.c)으로 비정상 종료(127)한다. 실측 확인.
process.exitCode = code;
