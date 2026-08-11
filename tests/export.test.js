import test from "node:test";
import assert from "node:assert/strict";

import { createWorkbook } from "../js/export.js";

test("薪资工作簿先展示重要说明，再保留明细工作表", () => {
  const previousXlsx = globalThis.XLSX;
  globalThis.XLSX = {
    utils: {
      book_new: () => ({ sheets: [] }),
      aoa_to_sheet: rows => ({ rows }),
      book_append_sheet: (workbook, worksheet, name) => workbook.sheets.push({ name, worksheet })
    }
  };
  try {
    const workbook = createWorkbook([["姓名", "实发"], ["张三", 8000]], "薪资表_2026-08", { notice: "演示估算" });
    assert.deepEqual(workbook.sheets.map(sheet => sheet.name), ["重要说明", "薪资表_2026-08"]);
    assert.equal(workbook.sheets[0].worksheet.rows[1][0], "演示估算");
    assert.deepEqual(workbook.sheets[1].worksheet.rows[0], ["姓名", "实发"]);
  } finally {
    if (previousXlsx === undefined) delete globalThis.XLSX;
    else globalThis.XLSX = previousXlsx;
  }
});
