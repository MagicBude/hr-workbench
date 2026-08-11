/*
 * check-js.js — 自有 JavaScript 语法检查入口
 *
 * 扫描 js/ 下的 ES Modules，并逐个调用当前 Node 运行时的 --check。
 * 这里只检查语法，不执行浏览器代码，也不能替代领域测试和页面回归。
 */

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const files = readdirSync(new URL("../js/", import.meta.url))
  .filter(name => name.endsWith(".js"))
  .sort()
  .map(name => fileURLToPath(new URL(`../js/${name}`, import.meta.url)));

// 每个文件单独检查，可以让 Node 直接报告真实文件名和语法位置。
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`JavaScript syntax check passed (${files.length} files).`);
