/*
 * payroll.js — 月度薪资核算页面
 *
 * 输入：当前月份、员工档案、组织薪资参数和用户编辑的收入/税额/状态。
 * 输出：state.data.payroll 中的月度记录、薪资表格以及 CSV 下载文件。
 * 协作：domain.js 提供初始薪资和税额口径，store.js 持久化，settings.js 编辑组织比例。
 *
 * 关键约束：草稿可按最新员工工资和组织参数重算；已确认/已发放记录是历史快照，
 * 页面渲染和比例变化都不能静默改写。当前个税仅为演示估算，不是正式财税结果。
 */

import { state, persist } from "./store.js";
import { fmtMoney, downloadFile, requestRefresh, showToast } from "./ui.js";
import { INSURANCE_RATIO, BIG_SICKNESS } from "./config.js";
import { openSettings } from "./settings.js";
import { estimateTax, escapeHtml, PAYROLL_STATUS, isEmployeeActiveInMonth, buildPayrollRecord } from "./domain.js";

// #region 核算字段与领域辅助

// 公司缴纳 / 个人缴纳的项目顺序（与表头一致）
const COMP_KEYS = ["养老", "医疗", "工伤", "失业", "生育", "公积金"];
const PERS_KEYS = ["养老", "医疗", "失业", "公积金", "大病医疗"];

// 取某员工某月工资记录；没有就按基本月薪新建一条（方便后续编辑）
function getOrCreatePay(month, empId) {
  let p = state.data.payroll.find(x => x.month === month && x.empId === empId);
  if (!p) {
    const e = state.data.employees.find(x => x.id === empId);
    p = buildPayrollRecord(month, empId, e ? e.baseSalary : 0);
    state.data.payroll.push(p);
  }
  return p;
}

// 社保基数：员工设置了 insuranceBase 就用它，否则用薪资的基本月薪
function baseOf(p) {
  const emp = state.data.employees.find(x => x.id === p.empId);
  return (emp && emp.insuranceBase != null) ? emp.insuranceBase : p.baseSalary;
}
// 组织比例（settings 里没有就用 config 默认）
function ratioOf() {
  return (state.data.settings && state.data.settings.insuranceRatio) || INSURANCE_RATIO;
}
// 大病医疗固定额（settings 里可改，否则用默认）
function bigSickness() {
  const s = state.data.settings;
  return (s && s.bigSickness != null) ? s.bigSickness : BIG_SICKNESS;
}

// 按当前员工基数和组织比例重算草稿。人工覆盖税额时保留用户输入，
// 但应发、个人缴纳和实发仍跟随收入变化更新。
function recompute(p) {
  const base = baseOf(p);
  const r = ratioOf();
  const c = r.company, pc = r.personal;
  p.comp = {
    养老: base * c.养老, 医疗: base * c.医疗, 工伤: base * c.工伤,
    失业: base * c.失业, 生育: base * c.生育, 公积金: base * c.公积金
  };
  p.pers = {
    养老: base * pc.养老, 医疗: base * pc.医疗, 失业: base * pc.失业,
    公积金: base * pc.公积金, 大病医疗: bigSickness()
  };
  p.compTotal = COMP_KEYS.reduce((s, k) => s + p.comp[k], 0);
  p.persTotal = PERS_KEYS.reduce((s, k) => s + p.pers[k], 0);
  p.gross = p.baseSalary + p.travel + p.bonus + p.overtime;   // 本月应发
  if (!p.taxManual) p.tax = estimateTax(p.gross, p.persTotal);
  p.net = p.gross - p.persTotal - p.tax;                       // 实发
}
function round2(number) {
  return Math.round(number * 100) / 100;
}
function employeesForMonth(month) {
  return state.data.employees.filter(e => !e.deletedAt && isEmployeeActiveInMonth(e, month));
}
function recomputeDraft(p) {
  if ((p.status || "draft") === "draft") { recompute(p); return; }
  p.comp ||= {};
  p.pers ||= {};
  p.compTotal = COMP_KEYS.reduce((sum, key) => sum + Number(p.comp[key] || 0), 0);
  p.persTotal = PERS_KEYS.reduce((sum, key) => sum + Number(p.pers[key] || 0), 0);
  p.gross ??= Number(p.baseSalary || 0) + Number(p.travel || 0) + Number(p.bonus || 0) + Number(p.overtime || 0);
  p.tax ??= 0;
  p.net ??= p.gross - p.persTotal - p.tax;
}

// #endregion 核算字段与领域辅助

// #region 页面初始化

export function initPayroll() {
  // "生成/刷新薪资"：对当前月份每位员工确保有一条薪资记录
  document.getElementById("genPayBtn").addEventListener("click", () => {
    const month = document.getElementById("payMonth").value || "2026-08";
    const employees = employeesForMonth(month);
    employees.forEach(e => {
      let p = state.data.payroll.find(x => x.month === month && x.empId === e.id);
      if (!p) { p = buildPayrollRecord(month, e.id, e.baseSalary); state.data.payroll.push(p); }
      else if ((p.status || "draft") === "draft") { p.baseSalary = e.baseSalary; recompute(p); }
    });
    persist();
    requestRefresh("payroll", "dashboard", "today");
    showToast(`已生成 ${month} 薪资（${employees.length} 人）`);
  });

  document.getElementById("csvBtn").addEventListener("click", exportCSV);
  document.getElementById("ratioBtn").addEventListener("click", () => openSettings("payroll"));
  document.getElementById("payMonth").addEventListener("change", renderPayroll);
}

// #endregion 页面初始化

// #region 薪资表渲染与编辑

export function renderPayroll() {
  const month = document.getElementById("payMonth").value || "2026-08";
  const tb = document.querySelector("#payTable tbody");
  const tf = document.querySelector("#payTable tfoot");
  tb.innerHTML = ""; tf.innerHTML = "";

  const employees = employeesForMonth(month);
  if (!employees.length) {
    tb.innerHTML = '<tr><td colspan="21" class="empty">请先在花名册添加员工。</td></tr>';
    return;
  }

  // 合计容器
  const tot = { gross: 0, compTotal: 0, persTotal: 0, tax: 0, net: 0, comp: {}, pers: {} };
  COMP_KEYS.forEach(k => tot.comp[k] = 0);
  PERS_KEYS.forEach(k => tot.pers[k] = 0);

  employees.forEach(e => {
    let p = state.data.payroll.find(x => x.month === month && x.empId === e.id);
    if (!p) p = buildPayrollRecord(month, e.id, e.baseSalary);
    recomputeDraft(p); // 已确认/已发放记录保持核算时的金额快照
    tot.gross += p.gross; tot.compTotal += p.compTotal; tot.persTotal += p.persTotal;
    tot.tax += p.tax; tot.net += p.net;
    COMP_KEYS.forEach(k => tot.comp[k] += p.comp[k]);
    PERS_KEYS.forEach(k => tot.pers[k] += p.pers[k]);

    const compCells = COMP_KEYS.map(k => `<td class="num mono">${fmtMoney(p.comp[k])}</td>`).join("");
    const persCells = PERS_KEYS.map(k => `<td class="num mono">${fmtMoney(p.pers[k])}</td>`).join("");
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(e.name)}</td><td>${escapeHtml(e.dept)}</td>
      <td class="num"><input class="p-base" type="number" min="0" value="${p.baseSalary}" data-id="${e.id}" ${p.status !== "draft" ? "disabled" : ""}></td>
      <td class="num"><input class="p-travel" type="number" min="0" value="${p.travel}" data-id="${e.id}" ${p.status !== "draft" ? "disabled" : ""}></td>
      <td class="num"><input class="p-bonus" type="number" min="0" value="${p.bonus}" data-id="${e.id}" ${p.status !== "draft" ? "disabled" : ""}></td>
      <td class="num"><input class="p-ot" type="number" min="0" value="${p.overtime}" data-id="${e.id}" ${p.status !== "draft" ? "disabled" : ""}></td>
      <td class="num mono">${fmtMoney(p.gross)}</td>
      ${compCells}${persCells}
      <td class="num"><input class="p-tax" type="number" min="0" value="${round2(p.tax)}" data-id="${e.id}" ${p.status !== "draft" ? "disabled" : ""} title="${p.taxManual ? "人工覆盖" : "演示估算"}"></td>
      <td class="num mono" style="color:var(--ok)">${fmtMoney(p.net)}</td>
      <td><select class="p-status" data-id="${e.id}">${Object.entries(PAYROLL_STATUS).map(([v,l]) => `<option value="${v}" ${p.status === v ? "selected" : ""}>${l}</option>`).join("")}</select></td>`;
    tb.appendChild(tr);
  });

  // 合计行
  const totCompCells = COMP_KEYS.map(k => `<td class="num mono">${fmtMoney(tot.comp[k])}</td>`).join("");
  const totPersCells = PERS_KEYS.map(k => `<td class="num mono">${fmtMoney(tot.pers[k])}</td>`).join("");
  tf.innerHTML = `<tr style="font-weight:500;"><td colspan="6">合计</td><td class="num mono">${fmtMoney(tot.gross)}</td>${totCompCells}${totPersCells}<td class="num mono">${fmtMoney(tot.tax)}</td><td class="num mono" style="color:var(--ok)">${fmtMoney(tot.net)}</td><td></td></tr>`;

  // 给每个输入框绑定"修改即重算"
  tb.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("change", () => {
      const p = getOrCreatePay(month, inp.dataset.id);
      if (inp.classList.contains("p-base")) p.baseSalary = +inp.value || 0;
      else if (inp.classList.contains("p-travel")) p.travel = +inp.value || 0;
      else if (inp.classList.contains("p-bonus")) p.bonus = +inp.value || 0;
      else if (inp.classList.contains("p-ot")) p.overtime = +inp.value || 0;
      else if (inp.classList.contains("p-tax")) { p.tax = +inp.value || 0; p.taxManual = true; }
      recompute(p);
      persist();
      requestRefresh("payroll", "dashboard", "today");
    });
  });
  tb.querySelectorAll(".p-status").forEach(sel => sel.addEventListener("change", () => {
    const p = getOrCreatePay(month, sel.dataset.id);
    if (p.status !== "draft" && sel.value === "draft" && !confirm("解锁会允许重新编辑薪资，确认改回草稿？")) { sel.value = p.status; return; }
    p.status = sel.value;
    persist();
    requestRefresh("payroll", "dashboard", "today");
  }));
}

// #endregion 薪资表渲染与编辑

// #region CSV 导出

// 带 UTF-8 BOM 可让常见 Windows Excel 正确识别中文。
// 当前字段转义和公式前缀防护仍需按审查计划补齐，不能把此导出用于不可信文本流转。
function exportCSV() {
  const month = document.getElementById("payMonth").value || "2026-08";
  const head = ["姓名", "部门", "基本月薪", "出差补贴", "奖金", "加班费", "本月应发",
    "公司养老", "公司医疗", "公司工伤", "公司失业", "公司生育", "公司公积金",
    "个人养老", "个人医疗", "个人失业", "个人公积金", "大病医疗", "个税", "实发薪资", "核算状态"];
  const rows = [head];
  employeesForMonth(month).forEach(e => {
    let p = state.data.payroll.find(x => x.month === month && x.empId === e.id);
    if (!p) p = buildPayrollRecord(month, e.id, e.baseSalary);
    recomputeDraft(p);
    rows.push([e.name, e.dept, p.baseSalary, p.travel, p.bonus, p.overtime, round2(p.gross),
      ...COMP_KEYS.map(k => round2(p.comp[k])),
      ...PERS_KEYS.map(k => round2(p.pers[k])),
      round2(p.tax), round2(p.net), PAYROLL_STATUS[p.status || "draft"]]);
  });
  const csv = "﻿" + rows.map(r => r.join(",")).join("\n");
  downloadFile(csv, "薪资_" + month + ".csv", "text/csv");
}

// #endregion CSV 导出
