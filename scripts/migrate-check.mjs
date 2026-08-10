// ============================================================
// migrate-check.mjs — 数据迁移回测脚本（Phase 5）
// ------------------------------------------------------------
// 用途：在 Node 里验证 store.migrate() 能把"旧版 JSON"自动升级为新结构，
//       确保老数据（如最初导出的斯迈孚 JSON）导入后不报错、字段齐全。
// 运行：node scripts/migrate-check.mjs
// 说明：这里 mock 了浏览器 localStorage（Node 环境没有），再 import 数据层。
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// mock 浏览器 localStorage（store.js 顶层不调用，但保险起见）
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Windows 下动态 import 必须用 file:// URL，不能直接用 C:\ 绝对路径
const store = await import(pathToFileURL(path.join(__dirname, "..", "js", "store.js")).href);

// 读取旧版 JSON（在仓库外层，避免误提交真实隐私）
const jsonPath = path.join(__dirname, "..", "..", "斯迈孚导入数据.json");
const obj = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

// 把旧数据喂给数据层并执行迁移
store.state.data = obj.data;
store.migrateCurrent();
const d = store.state.data;

let ok = true;
function check(name, cond) { console.log((cond ? "PASS" : "FAIL") + "  " + name); if (!cond) ok = false; }

check("员工含 restMinutes", d.employees.every(e => typeof e.restMinutes === "number"));
check("员工含 insuranceBase", d.employees.every(e => "insuranceBase" in e));
const firstRec = Object.values(d.attendance[0].rec)[0];
check("考勤已升级为分时段对象 {am,pm,ot}", !!(firstRec && typeof firstRec === "object" && "am" in firstRec && "pm" in firstRec && "ot" in firstRec));
check("节假日已注入(2026)", Object.keys(d.holidays || {}).length > 0);
check("settings 已注入(含 insuranceRatio)", !!(d.settings && d.settings.insuranceRatio));
check("attendance summary 键齐全", d.attendance.every(a => a.summary && "出勤" in a.summary && "加班" in a.summary));
check("payroll 含缴纳明细(comp/pers)", d.payroll.every(p => p.comp && p.pers));

console.log(ok ? "\n迁移回测：全部通过 ✓" : "\n迁移回测：存在失败项 ✗");
process.exit(ok ? 0 : 1);
