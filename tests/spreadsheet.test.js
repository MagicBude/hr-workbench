/*
 * spreadsheet.test.js — CSV 和电子表格公式注入回归测试
 *
 * 覆盖逗号、双引号、换行、中文及危险公式前缀，避免导出逻辑退回字符串拼接。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { escapeCsvCell, rowsToCsv, safeSpreadsheetRows, safeSpreadsheetText } from "../js/spreadsheet.js";

test("危险公式前缀被转换为普通文本", () => {
  for (const value of ["=1+1", "+cmd", "-2+3", "@SUM(A1)", "  =HYPERLINK()"] ) {
    assert.equal(safeSpreadsheetText(value).startsWith("'"), true);
  }
  assert.equal(safeSpreadsheetText("正常文本"), "正常文本");
});

test("CSV 正确处理逗号、引号、换行和公式", () => {
  assert.equal(escapeCsvCell('销售部,"华东"'), '"销售部,""华东"""');
  assert.equal(rowsToCsv([["姓名", "部门"], ["张\n三", "=1+1"]]), '"姓名","部门"\r\n"张\n三","\'=1+1"');
});

test("XLSX 行只转换文本，不改变数字类型", () => {
  assert.deepEqual(safeSpreadsheetRows([["=1+1", 1000]]), [["'=1+1", 1000]]);
});
