// ============================================================
// sample.js — 首次打开时注入的示例数据
// ------------------------------------------------------------
// 重要：所有姓名、部门、金额都是“虚构”的，方便你直接看到效果，
//       又不会在部署到公网时泄露任何真实隐私（符合数据隐私规范）。
// 这里还放了被多处复用的“计算函数”：
//   sumRec()        统计某人某月各考勤状态（兼容“分时段”新结构）
//   buildPayroll()  根据工资金额算出五险一金、个税、实发
// ============================================================

import { STATUS_LABEL, INSURANCE_RATIO, BIG_SICKNESS, HOLIDAYS_2026, DEFAULT_SETTINGS, SCHEMA_VERSION } from "./config.js";
import { estimateTax } from "./domain.js";

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
    attendance.push({ id: "a_07_" + e.id, month: "2026-07", empId: e.id, rec, summary: sumRec(rec) });
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

  // 5) 节假日 + 组织设置（示例用内置 2026 国家法定节假日与默认设置）
  employees.forEach(e => { e.employmentStatus = "active"; e.leaveDate = ""; e.deletedAt = null; });
  return { schemaVersion: SCHEMA_VERSION, employees, attendance, payroll, holidays: { ...HOLIDAYS_2026 }, settings: { ...DEFAULT_SETTINGS } };
}

// 统计某员工某月的考勤。
// 兼容两种结构：
//   新结构（分时段）：rec = { 1:{am:"√",pm:"√",ot:""}, ... }
//   旧结构（单格）  ：rec = { 1:"√", ... }
// 规则：上午/下午各算 0.5 天（按状态累计），加班时段单独计“次”。
// 注：迟到/早退 也计 0.5（占用一个半天槽位）；可调休余额的分钟级精度在动态计算里体现。
export function sumRec(rec) {
  const s = { 出勤: 0, 事假: 0, 病假: 0, 缺勤: 0, 调休: 0, 年假: 0, 加班: 0, 迟到: 0, 早退: 0 };
  for (const k in rec) {
    const cell = rec[k];
    if (cell && typeof cell === "object") {
      // 上午/下午两个时段：各 0.5 天，按状态累计（加班不计出勤天数）
      ["am", "pm"].forEach(sh => {
        const v = cell[sh];
        if (!v) return;
        const sv = (typeof v === "object") ? v.s : v;
        if (sv === "√") s.出勤 += 0.5;
        else if (sv) s[STATUS_LABEL[sv]] = (s[STATUS_LABEL[sv]] || 0) + 0.5;
      });
      const ot = cell.ot;
      if (ot) {
        const os = (typeof ot === "object") ? ot.s : ot;
        if (os === "加") s.加班 += 1;   // 加班时段单独计次
      }
    } else {
      // 旧结构：整天一个状态
      if (cell === "√") s.出勤++;
      else if (STATUS_LABEL[cell]) s[STATUS_LABEL[cell]] = (s[STATUS_LABEL[cell]] || 0) + 1;
    }
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
  const tax = estimateTax(gross, persTotal);                       // 简化个税估算
  const net = gross - persTotal - tax;                           // 实发 = 应发 - 个人缴纳 - 个税

  return {
    id: "p_" + month + "_" + empId, month, empId,
    baseSalary: base, travel, bonus, overtime,
    comp, pers, gross, persTotal, tax, taxManual: false, status: "draft", net
  };
}
