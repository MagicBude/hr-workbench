/*
 * domain.test.js — 纯业务规则的 Node 回归测试
 *
 * 直接测试 domain.js，不启动浏览器，也不接触 DOM/localStorage。
 * 这里覆盖日期、考勤分钟、薪资初值、转义和导入校验；浏览器交互与存储失败
 * 仍需要独立的集成或端到端测试。
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  attendanceMetrics,
  buildPayrollRecord,
  escapeHtml,
  estimateTax,
  isEmployeeActiveInMonth,
  isEmployeeActiveOn,
  isWorkdayDate,
  summarizeAttendance,
  validateImportPayload,
} from "../js/domain.js";

// #region 员工与工作日边界

test("员工入离职日期限定有效在职区间", () => {
  const emp = {
    hireDate: "2026-08-10",
    leaveDate: "2026-08-20",
    employmentStatus: "departed",
  };
  assert.equal(isEmployeeActiveOn(emp, "2026-08-09"), false);
  assert.equal(isEmployeeActiveOn(emp, "2026-08-10"), true);
  assert.equal(isEmployeeActiveOn(emp, "2026-08-20"), true);
  assert.equal(isEmployeeActiveOn(emp, "2026-08-21"), false);
});

test("月中入职又离职的员工仍属于该月有效员工", () => {
  const emp = {
    hireDate: "2026-08-10",
    leaveDate: "2026-08-20",
    employmentStatus: "departed",
  };
  assert.equal(isEmployeeActiveInMonth(emp, "2026-08"), true);
  assert.equal(isEmployeeActiveInMonth(emp, "2026-09"), false);
});

test("节假日覆盖周末和工作日", () => {
  assert.equal(isWorkdayDate("2026-08-10", {}), true);
  assert.equal(isWorkdayDate("2026-08-09", {}), false);
  assert.equal(isWorkdayDate("2026-08-09", { "2026-08-09": { type: "workday" } }), true);
});

// #endregion 员工与工作日边界

// #region 考勤、薪资与输入安全

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
  const emp = {
    hireDate: "2026-08-03",
    employmentStatus: "active",
    leaveDate: "2026-08-03",
  };
  const metrics = attendanceMetrics(
    emp,
    "2026-08",
    { rec: { 3: { am: { s: "事", min: 120 }, pm: "√" } } },
    {},
    240,
  );
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

test("考勤汇总和初始薪资记录使用统一领域函数", () => {
  const summary = summarizeAttendance({
    1: { am: "√", pm: "迟", ot: { s: "加", min: 90 } },
  });
  assert.deepEqual(
    { 出勤: summary.出勤, 迟到: summary.迟到, 加班: summary.加班 },
    { 出勤: 0.5, 迟到: 0.5, 加班: 1 },
  );
  const payroll = buildPayrollRecord("2026-08", "e1", 10000);
  assert.equal(payroll.status, "draft");
  assert.equal(payroll.taxManual, false);
  assert.equal(payroll.net, payroll.gross - payroll.persTotal - payroll.tax);
});

test("导入数据拒绝异形字段", () => {
  assert.throws(
    () =>
      validateImportPayload({
        data: { employees: {}, attendance: [], payroll: [] },
      }),
    /employees/,
  );
  assert.throws(
    () =>
      validateImportPayload({
        data: { employees: [{ name: 123 }], attendance: [], payroll: [] },
      }),
    /name/,
  );
  assert.throws(
    () =>
      validateImportPayload({
        data: {
          employees: [{ id: "e1" }, { id: "e1" }],
          attendance: [],
          payroll: [],
        },
      }),
    /重复 id/,
  );
  assert.throws(
    () =>
      validateImportPayload({
        data: {
          employees: [{ id: "e1", employmentStatus: "unknown" }],
          attendance: [],
          payroll: [],
        },
      }),
    /employmentStatus/,
  );
});

// #endregion 考勤、薪资与输入安全
