/*
 * build-export-preview.mjs — 导出主题人工验收样例生成器
 *
 * 输入：固定的花名册、考勤和薪资二维表示例。
 * 输出：tmp/export-preview.xlsx，仅供开发阶段打开或渲染检查。
 * 协作：复用 js/export.js 的工作簿主题，vendor/xlsx-js-style.min.js 负责写出样式。
 *
 * 本脚本不读取真实浏览器数据，也不参与生产页面；修改导出主题后运行它，可以确认
 * 字体、填充、边框、行高和数字格式确实进入最终 XLSX，而不只是停留在内存对象中。
 */

import fs from "node:fs";
import vm from "node:vm";
import { createCombinedWorkbook, workbookBytes } from "../js/export.js";
import { state } from "../js/store.js";

const vendorSource = fs.readFileSync(new URL("../vendor/xlsx-js-style.min.js", import.meta.url), "utf8");
const fflateSource = fs.readFileSync(new URL("../vendor/fflate-0.8.3.umd.js", import.meta.url), "utf8");
const browserLikeContext = { console, setTimeout, clearTimeout };
browserLikeContext.global = browserLikeContext;
browserLikeContext.window = browserLikeContext;
vm.runInNewContext(vendorSource, browserLikeContext);
vm.runInNewContext(fflateSource, browserLikeContext);
globalThis.XLSX = browserLikeContext.XLSX;
globalThis.fflate = browserLikeContext.fflate;

state.data = {
  employees: [
    { id: "e1", name: "张三", dept: "总经办", hireDate: "2020-03-01", baseSalary: 18000, restSeedMinutes: 960, insuranceBase: null, employmentStatus: "active", leaveDate: "", deletedAt: null },
    { id: "e2", name: "李四", dept: "销售部", hireDate: "2021-06-15", baseSalary: 12000, restSeedMinutes: 480, insuranceBase: 10000, employmentStatus: "active", leaveDate: "", deletedAt: null }
  ],
  attendance: [],
  payroll: [],
  settings: { halfDayMinutes: 240, overtimeToRest: true, overtimeToRestRatio: 1 },
  holidays: {}
};

const workbook = createCombinedWorkbook({
  modules: ["roster", "attendance", "payroll"],
  months: ["2026-08"],
  orgName: "样式验收组织",
  generatedAt: new Date("2026-08-12T10:00:00+08:00")
});

fs.mkdirSync(new URL("../tmp/", import.meta.url), { recursive: true });

// 在隔离上下文中使用纯内存写入，再由当前脚本保存文件，避免依赖库直接访问 Node 文件系统。
fs.writeFileSync(
  new URL("../tmp/export-preview.xlsx", import.meta.url),
  workbookBytes(workbook),
);
