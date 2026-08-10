// ============================================================
// sample.js — 首次启动使用的虚构示例数据
// ------------------------------------------------------------
// 重要：所有姓名、部门、金额都是“虚构”的，方便你直接看到效果，
//       又不会在部署到公网时泄露任何真实隐私（符合数据隐私规范）。
// ============================================================

import { HOLIDAYS_2026, DEFAULT_SETTINGS, SCHEMA_VERSION } from "./config.js";
import { summarizeAttendance, buildPayrollRecord } from "./domain.js";

// 生成一份完整的示例数据（data 对象）
export function buildSample() {
  // 1) 员工花名册：5 个虚构员工（restSeedMinutes=初始可调休余额分钟数；可用余额=初始+加班−调休 动态算）
  const employees = [
    { id: "e1", name: "张三", dept: "总经办", hireDate: "2020-03-01", baseSalary: 18000, restSeedMinutes: 960, insuranceBase: null },
    { id: "e2", name: "李四", dept: "销售部", hireDate: "2021-06-15", baseSalary: 12000, restSeedMinutes: 480, insuranceBase: null },
    { id: "e3", name: "王五", dept: "行政部", hireDate: "2022-09-01", baseSalary: 8000,  restSeedMinutes: 120, insuranceBase: null },
    { id: "e4", name: "赵六", dept: "财务部", hireDate: "2023-02-10", baseSalary: 9000,  restSeedMinutes: 0,   insuranceBase: null },
    { id: "e5", name: "孙七", dept: "销售部", hireDate: "2024-07-20", baseSalary: 7500,  restSeedMinutes: 240, insuranceBase: null }
  ];

  const attendance = [];

  // 2) 2026-07：全员满勤（每天上午/下午出勤，加班留空）——用于看板趋势和上月参考
  employees.forEach(e => {
    const rec = {};
    for (let d = 1; d <= 31; d++) rec[d] = { am: "√", pm: "√", ot: "" };
    attendance.push({ id: "a_07_" + e.id, month: "2026-07", empId: e.id, rec, summary: summarizeAttendance(rec) });
  });

  // 3) 2026-08（当前月）：大部分填到 8-10，王五(e3)只到 8-05 → 制造一条“逾期”
  //    李四 6-7 号事假、赵六 3 号病假、孙七 8 号上午调休 + 晚上加班，演示分时段与调休联动。
  employees.forEach(e => {
    const rec = {};
    const upTo = (e.id === "e3") ? 5 : 10;   // 王五只填到 5 号
    for (let d = 1; d <= upTo; d++) {
      let cell = { am: "√", pm: "√", ot: "" };      // 默认全天出勤
      if (e.id === "e2" && (d === 6 || d === 7)) cell = { am: "事", pm: "事", ot: "" };
      else if (e.id === "e4" && d === 3) cell = { am: "病", pm: "病", ot: "" };
      else if (e.id === "e5" && d === 8) cell = { am: "调", pm: "√", ot: "加" }; // 孙七：上午调休 / 下午出勤 / 晚上加班
      rec[d] = cell;
    }
    attendance.push({ id: "a_08_" + e.id, month: "2026-08", empId: e.id, rec, summary: summarizeAttendance(rec) });
  });

  // 4) 薪资：造 05/06/07 三个月（用于趋势折线），08 月故意留空 → 变成“待核算”
  const payroll = [];
  ["2026-05", "2026-06", "2026-07"].forEach((m, mi) => {
    employees.forEach(e => {
      const base = Math.round(e.baseSalary * (1 + (mi - 1) * 0.03)); // 让每月略涨，趋势更好看
      payroll.push(buildPayrollRecord(m, e.id, base));
    });
  });

  // 5) 节假日 + 组织设置（示例用内置 2026 国家法定节假日与默认设置）
  employees.forEach(e => { e.employmentStatus = "active"; e.leaveDate = ""; e.deletedAt = null; });
  return { schemaVersion: SCHEMA_VERSION, employees, attendance, payroll, holidays: { ...HOLIDAYS_2026 }, settings: { ...DEFAULT_SETTINGS } };
}
