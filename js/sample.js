// ============================================================
// sample.js — 首次打开时注入的示例数据
// ------------------------------------------------------------
// 重要：所有姓名、部门、金额都是“虚构”的，方便你直接看到效果，
//       又不会在部署到公网时泄露任何真实隐私（符合数据隐私规范）。
// 这里还放了两个被多处复用的“计算函数”：
//   sumRec()     统计某人某月各考勤状态的天数
//   buildPayroll() 根据工资金额算出五险一金、个税、实发
// ============================================================

import { STATUS_LABEL, INSURANCE_RATIO, BIG_SICKNESS, TAX_THRESHOLD, TAX_RATE } from "./config.js";

// 生成一份完整的示例数据（data 对象）
export function buildSample() {
  // 1) 员工花名册：5 个虚构员工（restMinutes=可调休余额分钟数，insuranceBase=null 用月薪）
  const employees = [
    { id: "e1", name: "张三", dept: "总经办", hireDate: "2020-03-01", baseSalary: 18000, restMinutes: 960, insuranceBase: null },
    { id: "e2", name: "李四", dept: "销售部", hireDate: "2021-06-15", baseSalary: 12000, restMinutes: 480, insuranceBase: null },
    { id: "e3", name: "王五", dept: "行政部", hireDate: "2022-09-01", baseSalary: 8000,  restMinutes: 120, insuranceBase: null },
    { id: "e4", name: "赵六", dept: "财务部", hireDate: "2023-02-10", baseSalary: 9000,  restMinutes: 0,   insuranceBase: null },
    { id: "e5", name: "孙七", dept: "销售部", hireDate: "2024-07-20", baseSalary: 7500,  restMinutes: 240, insuranceBase: null }
  ];

  const attendance = [];

  // 2) 2026-07：全员满勤（用于看板趋势和上月参考）
  employees.forEach(e => {
    const rec = {};
    for (let d = 1; d <= 31; d++) rec[d] = "√";
    attendance.push({ id: "a_07_" + e.id, month: "2026-07", empId: e.id, rec, summary: sumRec(rec) });
  });

  // 3) 2026-08（当前月）：大部分填到 8-10，王五(e3)只到 8-05 → 制造一条“逾期”
  //    李四 6-7 号事假、赵六 3 号病假，演示不同状态。
  employees.forEach(e => {
    const rec = {};
    const upTo = (e.id === "e3") ? 5 : 10;   // 王五只填到 5 号
    for (let d = 1; d <= upTo; d++) {
      if (e.id === "e2" && (d === 6 || d === 7)) rec[d] = "事";
      else if (e.id === "e4" && d === 3) rec[d] = "病";
      else rec[d] = "√";
    }
    attendance.push({ id: "a_08_" + e.id, month: "2026-08", empId: e.id, rec, summary: sumRec(rec) });
  });

  // 4) 薪资：造 05/06/07 三个月（用于趋势折线），08 月故意留空 → 变成“待核算”
  const payroll = [];
  ["2026-05", "2026-06", "2026-07"].forEach((m, mi) => {
    employees.forEach(e => {
      const base = Math.round(e.baseSalary * (1 + (mi - 1) * 0.03)); // 让每月略涨，趋势更好看
      payroll.push(buildPayroll(m, e.id, base, 0, 0, 0));
    });
  });

  return { employees, attendance, payroll };
}

// 统计某员工某月的考勤：输入 {1:"√",2:"事",...}，输出 {出勤:30,事假:2,...}
export function sumRec(rec) {
  const s = { 出勤: 0, 事假: 0, 病假: 0, 缺勤: 0, 调休: 0, 年假: 0, 加班: 0 };
  for (const k in rec) {
    const v = rec[k];
    if (v === "√") s.出勤++;
    else if (STATUS_LABEL[v]) s[STATUS_LABEL[v]]++; // 其它状态按中文名累加
  }
  return s;
}

// 计算单条薪资：基本月薪 + 补贴/奖金/加班 → 五险一金 → 个税 → 实发
export function buildPayroll(month, empId, base, travel, bonus, overtime) {
  const c = INSURANCE_RATIO.company;
  const p = INSURANCE_RATIO.personal;

  // 公司承担部分（各项 = 基数 × 比例）
  const comp = {
    养老: base * c.养老, 医疗: base * c.医疗, 工伤: base * c.工伤,
    失业: base * c.失业, 生育: base * c.生育, 公积金: base * c.公积金
  };
  // 个人承担部分
  const pers = {
    养老: base * p.养老, 医疗: base * p.医疗, 失业: base * p.失业,
    公积金: base * p.公积金, 大病医疗: BIG_SICKNESS
  };

  const gross = base + travel + bonus + overtime;                 // 本月应发
  const persTotal = pers.养老 + pers.医疗 + pers.失业 + pers.公积金 + pers.大病医疗; // 个人缴纳合计
  const tax = Math.max(0, (gross - persTotal - TAX_THRESHOLD)) * TAX_RATE;          // 简化个税
  const net = gross - persTotal - tax;                           // 实发 = 应发 - 个人缴纳 - 个税

  return {
    id: "p_" + month + "_" + empId, month, empId,
    baseSalary: base, travel, bonus, overtime,
    comp, pers, gross, persTotal, tax, net
  };
}
