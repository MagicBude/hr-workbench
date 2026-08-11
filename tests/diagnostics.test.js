/* diagnostics.test.js — 验证诊断日志轮换和敏感错误文本不会被记录。 */

import test from "node:test";
import assert from "node:assert/strict";
import { clearDiagnostics, getDiagnostics, reportError } from "../js/diagnostics.js";

test.beforeEach(clearDiagnostics);

test("诊断日志不记录错误消息和堆栈", () => {
  const error = new Error("员工张三薪资 10000");
  reportError(error, { module: "payroll", operation: "save" });
  const json = JSON.stringify(getDiagnostics());
  assert.equal(json.includes("张三"), false);
  assert.equal(json.includes("10000"), false);
  assert.equal(json.includes("stack"), false);
  assert.match(json, /payroll/);
});

test("诊断日志只保留最近五十条", () => {
  for (let index = 0; index < 55; index += 1) {
    reportError(new TypeError("private"), { module: "test", operation: `op-${index}` });
  }
  const diagnostics = getDiagnostics();
  assert.equal(diagnostics.entryCount, 50);
  assert.equal(diagnostics.entries[0].operation, "op-5");
});
