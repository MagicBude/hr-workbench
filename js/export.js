/*
 * export.js — Excel 工作簿导出
 *
 * 输入：当前组织的员工、考勤、薪资数据和目标月份。
 * 输出：可下载的花名册、考勤表或薪资表 .xlsx 文件。
 * 协作：store.js 提供数据和调休余额，domain.js 提供状态与任职区间，
 * vendor/xlsx-js-style.min.js 在本模块之前加载并暴露全局 XLSX。
 *
 * 样式版 SheetJS 兼容库固定放在本地 vendor 中以保持离线能力。导出字段必须与页面业务口径同步，
 * 用户文本还需要遵守审查计划中的电子表格公式注入防护要求。
 */

import { state, computeRestMinutes } from "./store.js";
import { WEEK_LABEL, SUM_KEYS, PAYROLL_DISCLAIMER } from "./config.js";
import { EMPLOYMENT_STATUS, PAYROLL_STATUS, isEmployeeActiveInMonth } from "./domain.js";
import { appendConstantColumn, safeSpreadsheetRows } from "./spreadsheet.js";

// #region 日期辅助
// 该月实际天数
function daysInMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}
// 该月某日是星期几（0=周日）
function weekdayOf(month, day) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, day).getDay();
}

// #endregion 日期辅助

export function monthRange(startMonth, endMonth, maxMonths = 12) {
  const pattern = /^\d{4}-(0[1-9]|1[0-2])$/;
  if (!pattern.test(startMonth) || !pattern.test(endMonth)) throw new Error("请选择有效的起止月份");
  const [startYear, startNumber] = startMonth.split("-").map(Number);
  const [endYear, endNumber] = endMonth.split("-").map(Number);
  const startIndex = startYear * 12 + startNumber - 1;
  const endIndex = endYear * 12 + endNumber - 1;
  if (endIndex < startIndex) throw new Error("结束月份不能早于开始月份");
  if (endIndex - startIndex + 1 > maxMonths) throw new Error(`一次最多导出连续 ${maxMonths} 个月`);
  return Array.from({ length: endIndex - startIndex + 1 }, (_, offset) => {
    const index = startIndex + offset;
    return `${Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, "0")}`;
  });
}

// #region 花名册导出

// ---------- 导出花名册 ----------
export function buildRosterRows() {
  const rows = [["序号", "姓名", "部门", "状态", "入职日期", "离职日期", "基本月薪", "可调休(小时)", "社保基数"]];
  state.data.employees.filter(e => !e.deletedAt).forEach((e, i) => {
    rows.push([i + 1, e.name, e.dept, EMPLOYMENT_STATUS[e.employmentStatus || "active"], e.hireDate || "", e.leaveDate || "", e.baseSalary,
      round1(computeRestMinutes(e.id) / 60), e.insuranceBase ?? ""]);
  });
  return rows;
}
export function exportRosterXlsx() {
  writeBook(buildRosterRows(), "花名册", "花名册.xlsx", { kind: "roster" });
}

// #endregion 花名册导出

// #region 考勤导出

// ---------- 导出考勤表（表头：日期+星期；每员工三行 上/下/加；右侧汇总） ----------
export function buildAttendanceRows(month) {
  const N = daysInMonth(month);
  const SHIFTS3 = [["am", "上午"], ["pm", "下午"], ["ot", "加班"]];

  // 表头第 1 行：固定列 + 日期 + 汇总列名
  const head1 = ["序号", "姓名", "部门", "时段"];
  for (let d = 1; d <= N; d++) head1.push(String(d));
  head1.push(...SUM_KEYS);
  // 表头第 2 行：星期（与日期列对齐）
  const head2 = ["", "", "", ""];
  for (let d = 1; d <= N; d++) head2.push(WEEK_LABEL[weekdayOf(month, d)]);
  head2.push(...SUM_KEYS.map(() => ""));

  const rows = [head1, head2];
  state.data.employees.filter(e => !e.deletedAt && isEmployeeActiveInMonth(e, month)).forEach((e, i) => {
    const a = state.data.attendance.find(x => x.month === month && x.empId === e.id);
    const rec = a ? a.rec : {};
    const s = a ? a.summary : { 出勤: 0, 事假: 0, 病假: 0, 缺勤: 0, 调休: 0, 年假: 0, 加班: 0 };
    SHIFTS3.forEach(([sh, label], si) => {
      // 只有"上午"行带 序号/姓名/部门 与汇总，其余两行留空（视觉合并效果）
      const row = si === 0 ? [i + 1, e.name, e.dept, label] : ["", "", "", label];
      for (let d = 1; d <= N; d++) {
        const cell = rec[d];
        // 新结构取对应时段；旧结构单值只放到"上午"行
        const value = cell && typeof cell === "object" ? (cell[sh] || "") : (sh === "am" ? (cell || "") : "");
        row.push(value && typeof value === "object" ? `${value.s || ""}${value.min != null ? `(${value.min}分钟)` : ""}` : value);
      }
      row.push(...(si === 0 ? SUM_KEYS.map(k => s[k]) : SUM_KEYS.map(() => "")));
      rows.push(row);
    });
  });
  return rows;
}
export function exportAttendanceXlsx(month) {
  writeBook(buildAttendanceRows(month), "考勤表_" + month, "考勤表_" + month + ".xlsx", { kind: "attendance" });
}

// #endregion 考勤导出

// #region 薪资导出

// ---------- 导出薪资表（含考勤统计 + 公司/个人缴纳分项） ----------
export function buildPayrollRows(month) {
  const COMP_KEYS = ["养老", "医疗", "工伤", "失业", "生育", "公积金"];
  const PERS_KEYS = ["养老", "医疗", "失业", "公积金", "大病医疗"];
  const rows = [["姓名", "部门", "入职日期", "出勤", "缺勤", "实出勤", "出差补贴", "奖金", "基本月薪", "加班费", "本月应发",
    "公司养老", "公司医疗", "公司工伤", "公司失业", "公司生育", "公司公积金",
    "个人养老", "个人医疗", "个人失业", "个人公积金", "大病医疗", "个税", "实发薪资", "核算状态"]];
  state.data.employees.filter(e => !e.deletedAt && isEmployeeActiveInMonth(e, month)).forEach(e => {
    const p = state.data.payroll.find(x => x.month === month && x.empId === e.id);
    const a = state.data.attendance.find(x => x.month === month && x.empId === e.id);
    const s = a ? a.summary : { 出勤: 0, 缺勤: 0 };
    if (!p) {
      // 未生成薪资：只导基础信息
      rows.push([e.name, e.dept, e.hireDate || "", s.出勤, s.缺勤, s.出勤,
        0, 0, e.baseSalary, 0, e.baseSalary, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, e.baseSalary, "未生成"]);
      return;
    }
    const comp = p.comp || {}, pers = p.pers || {};
    rows.push([e.name, e.dept, e.hireDate || "", s.出勤, s.缺勤, s.出勤,
      p.travel, p.bonus, p.baseSalary, p.overtime, round2(p.gross),
      ...COMP_KEYS.map(k => round2(comp[k] || 0)),
      ...PERS_KEYS.map(k => round2(pers[k] || 0)),
      round2(p.tax), round2(p.net), PAYROLL_STATUS[p.status || "draft"]]);
  });
  return appendConstantColumn(rows, "核算说明", PAYROLL_DISCLAIMER);
}
export function exportPayrollXlsx(month) {
  writeBook(
    buildPayrollRows(month),
    "薪资表_" + month,
    "薪资表_" + month + ".xlsx",
    { notice: PAYROLL_DISCLAIMER, kind: "payroll" }
  );
}

// #endregion 薪资导出

// #region 工作簿工具

// ---------- 工具 ----------
function round2(n) { return Math.round((n || 0) * 100) / 100; }
function round1(n) { return Math.round((n || 0) * 10) / 10; }
function excelColumnName(index) {
  let name = "", current = index + 1;
  while (current > 0) {
    current -= 1;
    name = String.fromCharCode(65 + current % 26) + name;
    current = Math.floor(current / 26);
  }
  return name;
}

const EXPORT_THEME = {
  blue: "185FA5",
  blueLight: "DCEAF7",
  greenLight: "E7F6EF",
  amberLight: "FFF4D6",
  grayLight: "F3F5F7",
  border: "D9E1E8",
  text: "243447",
  muted: "66788A",
  white: "FFFFFF"
};

function applyCellStyle(worksheet, rowIndex, columnIndex, style) {
  const cell = worksheet[`${excelColumnName(columnIndex)}${rowIndex + 1}`];
  if (cell) cell.s = style;
}

function bodyStyle(rowIndex, columnIndex, kind) {
  const base = {
    font: { name: "微软雅黑", sz: 10, color: { rgb: EXPORT_THEME.text } },
    alignment: { vertical: "center", horizontal: columnIndex === 0 ? "center" : "left" },
    border: { bottom: { style: "thin", color: { rgb: EXPORT_THEME.border } } }
  };
  if (rowIndex % 2 === 1) base.fill = { patternType: "solid", fgColor: { rgb: "F8FAFC" } };
  if (kind === "attendance" && columnIndex >= 4) base.alignment.horizontal = "center";
  if (kind === "payroll" && columnIndex >= 3 && columnIndex <= 23) {
    base.alignment.horizontal = "right";
    base.numFmt = '#,##0.00;[Red]-#,##0.00';
  }
  if (kind === "roster" && [6, 7, 8].includes(columnIndex)) {
    base.alignment.horizontal = "right";
    base.numFmt = '#,##0.00;[Red]-#,##0.00';
  }
  return base;
}

function headerStyle(columnIndex, kind, headerRow) {
  let fill = EXPORT_THEME.blue;
  let color = EXPORT_THEME.white;
  if (kind === "attendance" && headerRow === 1) {
    fill = EXPORT_THEME.blueLight;
    color = EXPORT_THEME.blue;
  } else if (kind === "payroll") {
    if (columnIndex >= 3 && columnIndex <= 10) fill = "DCEAF7";
    else if (columnIndex >= 11 && columnIndex <= 16) fill = "E7EAFE";
    else if (columnIndex >= 17 && columnIndex <= 22) fill = EXPORT_THEME.greenLight;
    else if (columnIndex === 23) fill = EXPORT_THEME.amberLight;
    if (fill !== EXPORT_THEME.blue) color = EXPORT_THEME.text;
  } else if (kind === "roster") {
    if (columnIndex <= 2) fill = EXPORT_THEME.blueLight;
    else if (columnIndex <= 5) fill = EXPORT_THEME.greenLight;
    else fill = EXPORT_THEME.amberLight;
    color = EXPORT_THEME.text;
  }
  return {
    font: { name: "微软雅黑", sz: 10, bold: true, color: { rgb: color } },
    fill: { patternType: "solid", fgColor: { rgb: fill } },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border: {
      top: { style: "thin", color: { rgb: EXPORT_THEME.border } },
      bottom: { style: "thin", color: { rgb: EXPORT_THEME.border } },
      left: { style: "thin", color: { rgb: EXPORT_THEME.border } },
      right: { style: "thin", color: { rgb: EXPORT_THEME.border } }
    }
  };
}

function worksheetFromRows(rows, { kind = "table" } = {}) {
  const safeRows = safeSpreadsheetRows(rows);
  const worksheet = XLSX.utils.aoa_to_sheet(safeRows);
  const columnCount = Math.max(1, ...safeRows.map(row => row.length));
  worksheet["!cols"] = Array.from({ length: columnCount }, (_, columnIndex) => {
    const width = Math.max(...safeRows.slice(0, 200).map(row => String(row[columnIndex] ?? "").length));
    return { wch: Math.min(32, Math.max(8, width + 2)) };
  });
  const headerRows = kind === "attendance" ? 2 : 1;
  worksheet["!rows"] = Array.from({ length: safeRows.length }, (_, rowIndex) => ({ hpt: rowIndex < headerRows ? 28 : 22 }));
  worksheet["!autofilter"] = { ref: `A${headerRows}:${excelColumnName(columnCount - 1)}${Math.max(headerRows, safeRows.length)}` };
  worksheet["!freeze"] = { xSplit: kind === "attendance" ? 4 : 2, ySplit: headerRows };
  for (let rowIndex = 0; rowIndex < safeRows.length; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      applyCellStyle(
        worksheet,
        rowIndex,
        columnIndex,
        rowIndex < headerRows ? headerStyle(columnIndex, kind, rowIndex) : bodyStyle(rowIndex, columnIndex, kind)
      );
    }
  }
  return worksheet;
}

function appendNoticeSheet(workbook, title, lines) {
  const noticeSheet = XLSX.utils.aoa_to_sheet([[title], ...lines.map(line => [line])]);
  noticeSheet["!cols"] = [{ wch: 96 }];
  noticeSheet["!rows"] = [{ hpt: 34 }, ...lines.map(() => ({ hpt: 24 }))];
  applyCellStyle(noticeSheet, 0, 0, {
    font: { name: "微软雅黑", sz: 16, bold: true, color: { rgb: EXPORT_THEME.white } },
    fill: { patternType: "solid", fgColor: { rgb: EXPORT_THEME.blue } },
    alignment: { vertical: "center" }
  });
  lines.forEach((_, index) => applyCellStyle(noticeSheet, index + 1, 0, {
    font: { name: "微软雅黑", sz: 10, color: { rgb: index === lines.length - 1 ? "9A5B00" : EXPORT_THEME.text } },
    fill: { patternType: "solid", fgColor: { rgb: index === lines.length - 1 ? EXPORT_THEME.amberLight : "F8FAFC" } },
    alignment: { vertical: "center", wrapText: true },
    border: { bottom: { style: "thin", color: { rgb: EXPORT_THEME.border } } }
  }));
  XLSX.utils.book_append_sheet(workbook, noticeSheet, "导出说明");
}

// 用 SheetJS 生成并触发下载
export function createWorkbook(aoa, sheetName, { notice = "", kind = "table" } = {}) {
  const wb = XLSX.utils.book_new();
  if (notice) {
    appendNoticeSheet(wb, "HR Workbench 薪资核算说明", [notice, "当前规则未覆盖累计预扣、税率级距、专项附加扣除、社保上下限及地区生效日期。"]);
  }
  const ws = worksheetFromRows(aoa, { kind });
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return wb;
}

export function createCombinedWorkbook({ modules, months, orgName = "当前组织", generatedAt = new Date() }) {
  if (!Array.isArray(modules) || !modules.length) throw new Error("请至少选择一个导出模块");
  if (!Array.isArray(months) || !months.length) throw new Error("请至少选择一个月份");
  const allowedModules = new Set(["roster", "attendance", "payroll"]);
  if (modules.some(module => !allowedModules.has(module))) throw new Error("包含不支持的导出模块");
  const workbook = XLSX.utils.book_new();
  const includesPayroll = modules.includes("payroll");
  const lines = [
    `组织：${orgName}`,
    `导出时间：${generatedAt.toLocaleString("zh-CN")}`,
    `月份范围：${months[0]} 至 ${months.at(-1)}`,
    `包含模块：${modules.map(module => ({ roster: "花名册", attendance: "考勤", payroll: "薪资" })[module]).join("、")}`
  ];
  if (includesPayroll) lines.push(PAYROLL_DISCLAIMER);
  appendNoticeSheet(workbook, "HR Workbench 综合报表", lines);
  if (modules.includes("roster")) XLSX.utils.book_append_sheet(workbook, worksheetFromRows(buildRosterRows(), { kind: "roster" }), "花名册");
  months.forEach(month => {
    if (modules.includes("attendance")) XLSX.utils.book_append_sheet(workbook, worksheetFromRows(buildAttendanceRows(month), { kind: "attendance" }), `考勤_${month}`);
    if (modules.includes("payroll")) XLSX.utils.book_append_sheet(workbook, worksheetFromRows(buildPayrollRows(month), { kind: "payroll" }), `薪资_${month}`);
  });
  return workbook;
}

export function exportCombinedXlsx(options) {
  const workbook = createCombinedWorkbook(options);
  const range = options.months.length === 1 ? options.months[0] : `${options.months[0]}_至_${options.months.at(-1)}`;
  XLSX.writeFile(workbook, `HR综合报表_${range}.xlsx`);
}

function writeBook(aoa, sheetName, filename, options = {}) {
  const wb = createWorkbook(aoa, sheetName, options);
  XLSX.writeFile(wb, filename);
}

// #endregion 工作簿工具
