import test from "node:test";
import assert from "node:assert/strict";

import { buildPayrollRows, createCombinedWorkbook, createWorkbook, monthRange, patchWorksheetFreezeXml } from "../js/export.js";
import { state } from "../js/store.js";

test("薪资工作簿先展示重要说明，再保留明细工作表", () => {
  const previousXlsx = globalThis.XLSX;
  globalThis.XLSX = {
    utils: {
      book_new: () => ({ sheets: [] }),
      aoa_to_sheet: rows => Object.assign({ rows }, Object.fromEntries(rows.flatMap((row, rowIndex) => row.map((value, columnIndex) => [`${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}`, { v: value }])))),
      book_append_sheet: (workbook, worksheet, name) => workbook.sheets.push({ name, worksheet })
    }
  };
  try {
    const workbook = createWorkbook([["姓名", "实发"], ["张三", 8000]], "薪资表_2026-08", { notice: "演示估算" });
    assert.deepEqual(workbook.sheets.map(sheet => sheet.name), ["导出说明", "薪资表_2026-08"]);
    assert.equal(workbook.sheets[0].worksheet.rows[1][0], "演示估算");
    assert.deepEqual(workbook.sheets[1].worksheet.rows[0], ["姓名", "实发"]);
    assert.equal(workbook.sheets[1].worksheet.A1.s.font.bold, true);
    assert.equal(workbook.sheets[1].worksheet.A1.s.font.name, "微软雅黑");
    assert.equal(workbook.sheets[1].worksheet.A2.s.font.name, "微软雅黑");
    assert.deepEqual(workbook.sheets[1].worksheet["!rows"], [{ hpt: 28 }, { hpt: 22 }]);
  } finally {
    if (previousXlsx === undefined) delete globalThis.XLSX;
    else globalThis.XLSX = previousXlsx;
  }
});

test("月份范围按月展开并限制最多十二个月", () => {
  assert.deepEqual(monthRange("2025-11", "2026-02"), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.throws(() => monthRange("2026-03", "2026-02"), /不能早于/);
  assert.throws(() => monthRange("2025-01", "2026-01"), /最多导出/);
});

test("冻结窗格配置会写入工作表 XML", () => {
  const source = '<worksheet><sheetViews><sheetView workbookViewId="0"/></sheetViews></worksheet>';
  const attendance = patchWorksheetFreezeXml(source, { xSplit: 4, ySplit: 2 });
  assert.match(attendance, /<pane xSplit="4" ySplit="2" topLeftCell="E3" activePane="bottomRight" state="frozen"\/>/);
  assert.equal(patchWorksheetFreezeXml(attendance, { xSplit: 4, ySplit: 2 }), attendance);
});

test("综合工作簿按模块和月份生成可辨识的工作表", () => {
  const previousXlsx = globalThis.XLSX;
  const previousData = state.data;
  globalThis.XLSX = {
    utils: {
      book_new: () => ({ sheets: [] }),
      aoa_to_sheet: rows => Object.assign({ rows }, Object.fromEntries(rows.flatMap((row, rowIndex) => row.map((value, columnIndex) => [`${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}`, { v: value }])))),
      book_append_sheet: (workbook, worksheet, name) => workbook.sheets.push({ name, worksheet })
    }
  };
  state.data = { employees: [], attendance: [], payroll: [], settings: {}, holidays: {} };
  try {
    const workbook = createCombinedWorkbook({
      modules: ["roster", "attendance", "payroll"],
      months: ["2026-07", "2026-08"],
      orgName: "测试组织",
      generatedAt: new Date("2026-08-11T00:00:00Z")
    });
    assert.deepEqual(workbook.sheets.map(sheet => sheet.name), [
      "导出说明", "计算参数", "花名册", "考勤_2026-07", "薪资_2026-07", "考勤_2026-08", "薪资_2026-08"
    ]);
    const attendanceSheet = workbook.sheets.find(sheet => sheet.name === "考勤_2026-07").worksheet;
    assert.equal(attendanceSheet["!cols"].length > 30, true);
    assert.deepEqual(attendanceSheet["!freeze"], { xSplit: 4, ySplit: 2 });
    assert.match(attendanceSheet["!autofilter"].ref, /^A2:/);
  } finally {
    state.data = previousData;
    if (previousXlsx === undefined) delete globalThis.XLSX;
    else globalThis.XLSX = previousXlsx;
  }
});

test("草稿薪资使用可追溯公式，已确认薪资保留金额快照", () => {
  const previousData = state.data;
  state.data = {
    employees: [
      { id: "e1", name: "张三", dept: "财务部", hireDate: "2020-01-01", baseSalary: 10000, insuranceBase: 8000, employmentStatus: "active", deletedAt: null },
      { id: "e2", name: "李四", dept: "行政部", hireDate: "2020-01-01", baseSalary: 9000, insuranceBase: null, employmentStatus: "active", deletedAt: null }
    ],
    attendance: [],
    payroll: [
      { empId: "e1", month: "2026-08", travel: 100, bonus: 200, baseSalary: 10000, overtime: 300, gross: 10600, comp: {}, pers: {}, persTotal: 1765, tax: 383.5, net: 8451.5, status: "draft" },
      { empId: "e2", month: "2026-08", travel: 0, bonus: 0, baseSalary: 9000, overtime: 0, gross: 9000, comp: {}, pers: {}, persTotal: 1985, tax: 201.5, net: 6813.5, status: "confirmed" }
    ],
    settings: {},
    holidays: {}
  };
  try {
    const rows = buildPayrollRows("2026-08");
    assert.equal(rows[1][9], 8000);
    assert.equal(rows[1][11].f, "SUM(G2:I2,K2)");
    assert.equal(rows[1][12].f, "J2*'计算参数'!$B$2");
    assert.match(rows[1][25].f, /MAX\(0,/);
    assert.equal(rows[1][26].f, "L2-X2-Z2");
    assert.equal(rows[2][11], 9000);
    assert.equal(typeof rows[2][26], "number");
    assert.equal(rows.length, 3);
  } finally {
    state.data = previousData;
  }
});
