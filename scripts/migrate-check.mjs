/*
 * migrate-check.mjs — 手动数据迁移回测脚本
 *
 * 输入：仓库外层指定的旧版 JSON；输出：各迁移断言的 PASS/FAIL 和进程退出码。
 * 协作：在 Node 中模拟 localStorage 后动态加载 store.js，避免依赖浏览器页面。
 *
 * 该脚本依赖开发者本机的历史样本，不属于 npm test 的稳定测试集；通用迁移场景
 * 应逐步改写为仓库内的脱敏 fixture 和 node:test 用例。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// #region Node 浏览器环境适配

// mock 浏览器 localStorage（store.js 顶层不调用，但保险起见）
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Windows 下动态 import 必须用 file:// URL，不能直接用 C:\ 绝对路径
const store = await import(pathToFileURL(path.join(__dirname, "..", "js", "store.js")).href);

// #endregion Node 浏览器环境适配

// #region 旧数据迁移与断言

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

// #endregion 旧数据迁移与断言
