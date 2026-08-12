import test from "node:test";
import assert from "node:assert/strict";

import { createCombinedWorkbook, createWorkbook, monthRange } from "../js/export.js";
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
      "导出说明", "花名册", "考勤_2026-07", "薪资_2026-07", "考勤_2026-08", "薪资_2026-08"
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
