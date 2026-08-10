import test from "node:test";
import assert from "node:assert/strict";
import { attendanceMetrics, escapeHtml, estimateTax, isEmployeeActiveOn, isWorkdayDate, validateImportPayload } from "../js/domain.js";

test("员工入离职日期限定有效在职区间", () => {
  const emp = { hireDate: "2026-08-10", leaveDate: "2026-08-20", employmentStatus: "departed" };
  assert.equal(isEmployeeActiveOn(emp, "2026-08-09"), false);
  assert.equal(isEmployeeActiveOn(emp, "2026-08-10"), true);
  assert.equal(isEmployeeActiveOn(emp, "2026-08-20"), true);
  assert.equal(isEmployeeActiveOn(emp, "2026-08-21"), false);
});

test("节假日覆盖周末和工作日", () => {
  assert.equal(isWorkdayDate("2026-08-10", {}), true);
  assert.equal(isWorkdayDate("2026-08-09", {}), false);
  assert.equal(isWorkdayDate("2026-08-09", { "2026-08-09": { type: "workday" } }), true);
});

test("出勤率按应出勤分钟计算并单列未录入", () => {
  const emp = { hireDate: "2026-08-03", employmentStatus: "active" };
  const att = { rec: { 3: { am: "√", pm: "迟" }, 4: { am: "事", pm: "缺" } } };
  const metrics = attendanceMetrics(emp, "2026-08", att, {}, 240);
  assert.equal(metrics.expectedMinutes, 21 * 480);
  assert.equal(metrics.actualMinutes, 480);
  assert.equal(metrics.leaveMinutes, 240);
  assert.equal(metrics.absentMinutes, 240);
  assert.equal(metrics.missingMinutes, 19 * 480);
  assert.equal(metrics.lateCount, 1);
});

test("部分请假按实际分钟拆分出勤与请假", () => {
  const emp = { hireDate: "2026-08-03", employmentStatus: "active", leaveDate: "2026-08-03" };
  const metrics = attendanceMetrics(emp, "2026-08", { rec: { 3: { am: { s: "事", min: 120 }, pm: "√" } } }, {}, 240);
  assert.equal(metrics.expectedMinutes, 480);
  assert.equal(metrics.actualMinutes, 360);
  assert.equal(metrics.leaveMinutes, 120);
});

test("当前月只统计截止日，不把未来日期算作未录入", () => {
  const emp = { hireDate: "2026-08-01", employmentStatus: "active" };
  const metrics = attendanceMetrics(emp, "2026-08", null, {}, 240, "2026-08-04");
  assert.equal(metrics.expectedMinutes, 2 * 480);
  assert.equal(metrics.missingMinutes, 2 * 480);
});

test("个税估算与 HTML 转义", () => {
  assert.equal(estimateTax(10000, 1000), 400);
  assert.equal(escapeHtml('<img onerror="x">'), "&lt;img onerror=&quot;x&quot;&gt;");
});

test("导入数据拒绝异形字段", () => {
  assert.throws(() => validateImportPayload({ data: { employees: {}, attendance: [], payroll: [] } }), /employees/);
  assert.throws(() => validateImportPayload({ data: { employees: [{ name: 123 }], attendance: [], payroll: [] } }), /name/);
});
