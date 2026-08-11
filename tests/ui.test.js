import test from "node:test";
import assert from "node:assert/strict";

import { normalizeColumnWidths } from "../js/ui.js";

test("合法列宽偏好按最小和最大值收敛", () => {
  assert.deepEqual(
    normalizeColumnWidths([20, 120, 900], [40, 80, 100], { min: 40, max: 600 }),
    [40, 120, 600]
  );
});

test("损坏或长度不符的列宽偏好整体恢复默认值", () => {
  assert.deepEqual(normalizeColumnWidths([80, NaN], [44, 110]), [44, 110]);
  assert.deepEqual(normalizeColumnWidths([80], [44, 110]), [44, 110]);
  assert.deepEqual(normalizeColumnWidths("80,110", [44, 110]), [44, 110]);
});
