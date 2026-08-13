/*
 * export.js — Excel 工作簿导出
 *
 * 输入：当前组织的员工、考勤、薪资数据和目标月份。
 * 输出：可下载的花名册、考勤表或薪资表 .xlsx 文件。
 * 协作：store.js 提供数据和调休余额，domain.js 提供状态与任职区间，
 * vendor/xlsx-js-style.min.js 与 fflate 在本模块之前加载，分别负责生成工作簿和封装 XLSX。
 *
 * 样式版 SheetJS 兼容库固定放在本地 vendor 中以保持离线能力。导出字段必须与页面业务口径同步，
 * 用户文本还需要遵守审查计划中的电子表格公式注入防护要求。
 */

import { state, computeRestMinutes } from "./store.js";
import {
  WEEK_LABEL,
  SUM_KEYS,
  PAYROLL_DISCLAIMER,
  INSURANCE_RATIO,
  BIG_SICKNESS,
  TAX_THRESHOLD,
  TAX_RATE
} from "./config.js";
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

function payrollParameters() {
  const settings = state.data.settings || {};
  return {
    insuranceRatio: settings.insuranceRatio || INSURANCE_RATIO,
    bigSickness: settings.bigSickness ?? BIG_SICKNESS,
    taxThreshold: TAX_THRESHOLD,
    taxRate: TAX_RATE
  };
}

function formulaCell(formula, cachedValue = 0) {
  return { t: "n", f: formula, v: round2(cachedValue) };
}

// 公式固定引用“计算参数”页；输入列变化后，Excel/WPS 会重新计算草稿和模板行。
function payrollFormulaRow(rowNumber, cached = {}) {
  const personalTotal = `SUM(S${rowNumber}:W${rowNumber})`;
  return {
    gross: formulaCell(`SUM(G${rowNumber}:I${rowNumber},K${rowNumber})`, cached.gross),
    company: ["$B$2", "$B$3", "$B$4", "$B$5", "$B$6", "$B$7"].map((parameterCell, index) =>
      formulaCell(`J${rowNumber}*'计算参数'!${parameterCell}`, cached.company?.[index])),
    personal: ["$B$8", "$B$9", "$B$10", "$B$11"].map((parameterCell, index) =>
      formulaCell(`J${rowNumber}*'计算参数'!${parameterCell}`, cached.personal?.[index])),
    bigSickness: formulaCell(`IF(COUNTA(A${rowNumber}:K${rowNumber})=0,0,'计算参数'!$B$12)`, cached.personal?.[4]),
    personalTotal: formulaCell(personalTotal, cached.personalTotal),
    tax: formulaCell(`IF(Y${rowNumber}="",MAX(0,(L${rowNumber}-X${rowNumber}-'计算参数'!$B$13)*'计算参数'!$B$14),Y${rowNumber})`, cached.tax),
    net: formulaCell(`L${rowNumber}-X${rowNumber}-Z${rowNumber}`, cached.net)
  };
}

function payrollParameterRows() {
  const parameters = payrollParameters();
  return [
    ["参数", "数值", "说明"],
    ["公司养老", parameters.insuranceRatio.company.养老, "社保基数 × 比例"],
    ["公司医疗", parameters.insuranceRatio.company.医疗, "社保基数 × 比例"],
    ["公司工伤", parameters.insuranceRatio.company.工伤, "社保基数 × 比例"],
    ["公司失业", parameters.insuranceRatio.company.失业, "社保基数 × 比例"],
    ["公司生育", parameters.insuranceRatio.company.生育, "社保基数 × 比例"],
    ["公司公积金", parameters.insuranceRatio.company.公积金, "社保基数 × 比例"],
    ["个人养老", parameters.insuranceRatio.personal.养老, "社保基数 × 比例"],
    ["个人医疗", parameters.insuranceRatio.personal.医疗, "社保基数 × 比例"],
    ["个人失业", parameters.insuranceRatio.personal.失业, "社保基数 × 比例"],
    ["个人公积金", parameters.insuranceRatio.personal.公积金, "社保基数 × 比例"],
    ["大病医疗", parameters.bigSickness, "固定金额（元/月）"],
    ["个税起征点", parameters.taxThreshold, "演示用月度起征点"],
    ["个税简化税率", parameters.taxRate, "演示用单一税率，非真实累进税率"]
  ];
}

// ---------- 导出薪资表（含可追溯公式、考勤统计和公司/个人缴纳分项） ----------
export function buildPayrollRows(month) {
  const COMP_KEYS = ["养老", "医疗", "工伤", "失业", "生育", "公积金"];
  const PERS_KEYS = ["养老", "医疗", "失业", "公积金", "大病医疗"];
  const rows = [["姓名", "部门", "入职日期", "出勤", "缺勤", "实出勤", "出差补贴", "奖金", "基本月薪", "社保基数", "加班费", "本月应发",
    "公司养老", "公司医疗", "公司工伤", "公司失业", "公司生育", "公司公积金",
    "个人养老", "个人医疗", "个人失业", "个人公积金", "大病医疗", "个人缴纳合计", "人工个税", "个税", "实发薪资", "核算状态"]];
  state.data.employees.filter(e => !e.deletedAt && isEmployeeActiveInMonth(e, month)).forEach(e => {
    const p = state.data.payroll.find(x => x.month === month && x.empId === e.id);
    const a = state.data.attendance.find(x => x.month === month && x.empId === e.id);
    const s = a ? a.summary : { 出勤: 0, 缺勤: 0 };
    const source = p || { travel: 0, bonus: 0, baseSalary: e.baseSalary, overtime: 0, status: "draft" };
    const comp = source.comp || {}, pers = source.pers || {};
    const cached = {
      gross: source.gross ?? source.baseSalary,
      company: COMP_KEYS.map(key => comp[key] || 0),
      personal: PERS_KEYS.map(key => pers[key] || 0),
      personalTotal: source.persTotal || 0,
      tax: source.tax || 0,
      net: source.net ?? source.baseSalary
    };
    const insuranceBase = e.insuranceBase ?? source.baseSalary;
    const isSnapshot = source.status === "confirmed" || source.status === "paid";
    const formulas = payrollFormulaRow(rows.length + 1, cached);
    rows.push([e.name, e.dept, e.hireDate || "", s.出勤, s.缺勤, s.出勤,
      source.travel, source.bonus, source.baseSalary, insuranceBase, source.overtime,
      isSnapshot ? round2(cached.gross) : formulas.gross,
      ...(isSnapshot ? cached.company.map(round2) : formulas.company),
      ...(isSnapshot ? cached.personal.map(round2) : [...formulas.personal, formulas.bigSickness]),
      isSnapshot ? round2(cached.personalTotal) : formulas.personalTotal,
      source.taxManual ? round2(source.tax) : "",
      isSnapshot ? round2(cached.tax) : formulas.tax,
      isSnapshot ? round2(cached.net) : formulas.net,
      p ? PAYROLL_STATUS[source.status || "draft"] : "未生成"]);
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
  if (kind === "payroll" && columnIndex >= 3 && columnIndex <= 28) {
    base.alignment.horizontal = "right";
    base.numFmt = '#,##0.00;[Red]-#,##0.00';
  }
  if (kind === "payroll" && [6, 7, 8, 9, 10, 24].includes(columnIndex)) {
    base.fill = { patternType: "solid", fgColor: { rgb: EXPORT_THEME.amberLight } };
  }
  if (kind === "payroll" && [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 25, 26, 27].includes(columnIndex)) {
    base.fill = { patternType: "solid", fgColor: { rgb: EXPORT_THEME.greenLight } };
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
    if (columnIndex >= 3 && columnIndex <= 11) fill = "DCEAF7";
    else if (columnIndex >= 12 && columnIndex <= 17) fill = "E7EAFE";
    else if (columnIndex >= 18 && columnIndex <= 27) fill = EXPORT_THEME.greenLight;
    else if (columnIndex === 28) fill = EXPORT_THEME.amberLight;
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

function appendPayrollParameterSheet(workbook) {
  const worksheet = worksheetFromRows(payrollParameterRows(), { kind: "parameters" });
  worksheet["!cols"] = [{ wch: 18 }, { wch: 16 }, { wch: 34 }];
  for (let rowIndex = 1; rowIndex <= 10; rowIndex += 1) {
    if (worksheet[`B${rowIndex + 1}`]) worksheet[`B${rowIndex + 1}`].z = "0.00%";
  }
  if (worksheet.B14) worksheet.B14.z = "0.00%";
  XLSX.utils.book_append_sheet(workbook, worksheet, "计算参数");
}

function enableFormulaRecalculation(workbook) {
  workbook.Workbook ||= {};
  workbook.Workbook.CalcPr = { calcMode: "auto", fullCalcOnLoad: true, forceFullCalc: true };
}

// 用 SheetJS 生成并触发下载
export function createWorkbook(aoa, sheetName, { notice = "", kind = "table" } = {}) {
  const wb = XLSX.utils.book_new();
  if (notice) {
    appendNoticeSheet(wb, "HR Workbench 薪资核算说明", [notice, "当前规则未覆盖累计预扣、税率级距、专项附加扣除、社保上下限及地区生效日期。"]);
  }
  if (kind === "payroll") appendPayrollParameterSheet(wb);
  const ws = worksheetFromRows(aoa, { kind });
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  if (kind === "payroll") enableFormulaRecalculation(wb);
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
  if (includesPayroll) appendPayrollParameterSheet(workbook);
  if (modules.includes("roster")) XLSX.utils.book_append_sheet(workbook, worksheetFromRows(buildRosterRows(), { kind: "roster" }), "花名册");
  months.forEach(month => {
    if (modules.includes("attendance")) XLSX.utils.book_append_sheet(workbook, worksheetFromRows(buildAttendanceRows(month), { kind: "attendance" }), `考勤_${month}`);
    if (modules.includes("payroll")) XLSX.utils.book_append_sheet(workbook, worksheetFromRows(buildPayrollRows(month), { kind: "payroll" }), `薪资_${month}`);
  });
  if (includesPayroll) enableFormulaRecalculation(workbook);
  return workbook;
}

export function exportCombinedXlsx(options) {
  const workbook = createCombinedWorkbook(options);
  const range = options.months.length === 1 ? options.months[0] : `${options.months[0]}_至_${options.months.at(-1)}`;
  downloadWorkbook(workbook, `HR综合报表_${range}.xlsx`);
}

function writeBook(aoa, sheetName, filename, options = {}) {
  const wb = createWorkbook(aoa, sheetName, options);
  downloadWorkbook(wb, filename);
}

// xlsx-js-style 会保留 !freeze 供业务层描述冻结范围，但不会把它写进工作表 XML。
// 因此统一在文件封装阶段补入 pane，避免网页与导出文件的固定表头体验不一致。
export function patchWorksheetFreezeXml(xml, freeze) {
  if (!freeze || (!freeze.xSplit && !freeze.ySplit) || /<pane\b/.test(xml)) return xml;
  const xSplit = Number(freeze.xSplit) || 0;
  const ySplit = Number(freeze.ySplit) || 0;
  const topLeftCell = `${excelColumnName(xSplit)}${ySplit + 1}`;
  const activePane = xSplit && ySplit ? "bottomRight" : xSplit ? "topRight" : "bottomLeft";
  const attributes = [
    xSplit ? `xSplit="${xSplit}"` : "",
    ySplit ? `ySplit="${ySplit}"` : "",
    `topLeftCell="${topLeftCell}"`,
    `activePane="${activePane}"`,
    'state="frozen"'
  ].filter(Boolean).join(" ");
  const pane = `<pane ${attributes}/>`;
  if (/<sheetView\b[^>]*\/>/.test(xml)) {
    return xml.replace(/<sheetView\b([^>]*)\/>/, `<sheetView$1>${pane}</sheetView>`);
  }
  return xml.replace(/(<sheetView\b[^>]*>)/, `$1${pane}`);
}

export function workbookBytes(workbook) {
  if (!globalThis.fflate) throw new Error("Excel 冻结窗格组件未加载，请刷新页面后重试");
  const rawBytes = new Uint8Array(XLSX.write(workbook, { bookType: "xlsx", type: "array" }));
  const archive = globalThis.fflate.unzipSync(rawBytes);
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  workbook.SheetNames.forEach((sheetName, sheetIndex) => {
    const freeze = workbook.Sheets[sheetName]?.["!freeze"];
    if (!freeze) return;
    const path = `xl/worksheets/sheet${sheetIndex + 1}.xml`;
    if (!archive[path]) throw new Error(`Excel 工作表文件缺失：${path}`);
    archive[path] = encoder.encode(patchWorksheetFreezeXml(decoder.decode(archive[path]), freeze));
  });
  return globalThis.fflate.zipSync(archive, { level: 6 });
}

function downloadWorkbook(workbook, filename) {
  const blob = new Blob([workbookBytes(workbook)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

// #endregion 工作簿工具
