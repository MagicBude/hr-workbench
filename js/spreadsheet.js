/*
 * spreadsheet.js — 电子表格文本安全与 CSV 编码
 *
 * 输入：用户可控的单元格值或二维行数组。
 * 输出：不会被常见表格软件解释为公式的文本，以及符合 RFC 4180 习惯的 CSV。
 * 协作：export.js 的 XLSX 和 payroll.js 的 CSV 共用这里的同一安全口径。
 */

// #region 单元格安全

// Excel/LibreOffice 会把 =、+、-、@ 开头的文本当作公式；前导空白也不能绕过检查。
export function safeSpreadsheetText(value) {
  const text = String(value ?? "");
  return /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
}

export function safeSpreadsheetRows(rows) {
  return rows.map(row => row.map(value => typeof value === "string" ? safeSpreadsheetText(value) : value));
}

// #endregion 单元格安全

// #region CSV 编码

export function escapeCsvCell(value) {
  const text = safeSpreadsheetText(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function rowsToCsv(rows) {
  return rows.map(row => row.map(escapeCsvCell).join(",")).join("\r\n");
}

// #endregion CSV 编码
