import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const files = readdirSync(new URL("../js/", import.meta.url))
  .filter(name => name.endsWith(".js"))
  .sort()
  .map(name => fileURLToPath(new URL(`../js/${name}`, import.meta.url)));

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`JavaScript syntax check passed (${files.length} files).`);
