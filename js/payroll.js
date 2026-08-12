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

import { state, persist, loadPreference, savePreference, removePreference } from "./store.js";
import { fmtMoney, downloadFile, enableColResize, normalizeColumnWidths, requestRefresh, showToast, requestConfirm } from "./ui.js";
import { INSURANCE_RATIO, BIG_SICKNESS, PAYROLL_DISCLAIMER } from "./config.js";
import { openSettings } from "./settings.js";
import { estimateTax, escapeHtml, PAYROLL_STATUS, isEmployeeActiveInMonth, buildPayrollRecord, canTransitionPayrollStatus, requireNonNegativeNumber } from "./domain.js";
import { appendConstantColumn, rowsToCsv } from "./spreadsheet.js";

// #region 核算字段与领域辅助

// 公司缴纳 / 个人缴纳的项目顺序（与表头一致）
const COMP_KEYS = ["养老", "医疗", "工伤", "失业", "生育", "公积金"];
const PERS_KEYS = ["养老", "医疗", "失业", "公积金", "大病医疗"];
// 姓名、部门、4 项收入、应发、6 项公司缴纳、5 项个人缴纳、个税、实发、状态。
// 默认宽度与表头字段一一对应，便于学习者对照，也为损坏偏好提供完整回退。
const PAYROLL_DEFAULT_WIDTHS = [90, 110, 90, 90, 80, 80, 100,
  86, 86, 76, 76, 76, 86, 86, 86, 76, 86, 96, 86, 100, 100];

// 取某员工某月工资记录；没有就按基本月薪新建一条（方便后续编辑）
function getOrCreatePay(month, empId) {
  let payrollRecord = state.data.payroll.find(item => item.month === month && item.empId === empId);
  if (!payrollRecord) {
    const employee = state.data.employees.find(item => item.id === empId);
    payrollRecord = buildPayrollRecord(month, empId, employee ? employee.baseSalary : 0);
    state.data.payroll.push(payrollRecord);
  }
  return payrollRecord;
}

// 社保基数：员工设置了 insuranceBase 就用它，否则用薪资的基本月薪
function baseOf(payrollRecord) {
  const employee = state.data.employees.find(item => item.id === payrollRecord.empId);
  const value = (employee && employee.insuranceBase != null)
    ? employee.insuranceBase
    : payrollRecord.baseSalary;
  return requireNonNegativeNumber(value, "社保基数");
}
// 组织比例（settings 里没有就用 config 默认）
function ratioOf() {
  return (state.data.settings && state.data.settings.insuranceRatio) || INSURANCE_RATIO;
}
// 大病医疗固定额（settings 里可改，否则用默认）
function bigSickness() {
  const settings = state.data.settings;
  return (settings && settings.bigSickness != null) ? settings.bigSickness : BIG_SICKNESS;
}

// 按当前员工基数和组织比例重算草稿。人工覆盖税额时保留用户输入，
// 但应发、个人缴纳和实发仍跟随收入变化更新。
function recompute(payrollRecord) {
  const insuranceBase = baseOf(payrollRecord);
  const insuranceRatio = ratioOf();
  const companyRatio = insuranceRatio.company;
  const personalRatio = insuranceRatio.personal;
  payrollRecord.comp = {
    养老: insuranceBase * companyRatio.养老,
    医疗: insuranceBase * companyRatio.医疗,
    工伤: insuranceBase * companyRatio.工伤,
    失业: insuranceBase * companyRatio.失业,
    生育: insuranceBase * companyRatio.生育,
    公积金: insuranceBase * companyRatio.公积金
  };
  payrollRecord.pers = {
    养老: insuranceBase * personalRatio.养老,
    医疗: insuranceBase * personalRatio.医疗,
    失业: insuranceBase * personalRatio.失业,
    公积金: insuranceBase * personalRatio.公积金,
    大病医疗: bigSickness()
  };
  payrollRecord.compTotal = COMP_KEYS.reduce((sum, key) => sum + payrollRecord.comp[key], 0);
  payrollRecord.persTotal = PERS_KEYS.reduce((sum, key) => sum + payrollRecord.pers[key], 0);
  payrollRecord.gross = payrollRecord.baseSalary + payrollRecord.travel
    + payrollRecord.bonus + payrollRecord.overtime;
  if (!payrollRecord.taxManual) {
    payrollRecord.tax = estimateTax(payrollRecord.gross, payrollRecord.persTotal);
  }
  payrollRecord.net = payrollRecord.gross - payrollRecord.persTotal - payrollRecord.tax;
}
function round2(number) {
  return Math.round(number * 100) / 100;
}
function employeesForMonth(month) {
  return state.data.employees.filter(e => !e.deletedAt && isEmployeeActiveInMonth(e, month));
}
function recomputeDraft(payrollRecord) {
  if ((payrollRecord.status || "draft") === "draft") {
    recompute(payrollRecord);
    return;
  }
  payrollRecord.comp ||= {};
  payrollRecord.pers ||= {};
  payrollRecord.compTotal = COMP_KEYS.reduce((sum, key) => sum + Number(payrollRecord.comp[key] || 0), 0);
  payrollRecord.persTotal = PERS_KEYS.reduce((sum, key) => sum + Number(payrollRecord.pers[key] || 0), 0);
  payrollRecord.gross ??= Number(payrollRecord.baseSalary || 0)
    + Number(payrollRecord.travel || 0)
    + Number(payrollRecord.bonus || 0)
    + Number(payrollRecord.overtime || 0);
  payrollRecord.tax ??= 0;
  payrollRecord.net ??= payrollRecord.gross - payrollRecord.persTotal - payrollRecord.tax;
}

// #endregion 核算字段与领域辅助

// #region 页面初始化

export function initPayroll() {
  // "生成/刷新薪资"：对当前月份每位员工确保有一条薪资记录
  document.getElementById("genPayBtn").addEventListener("click", () => {
    const month = document.getElementById("payMonth").value || "2026-08";
    const employees = employeesForMonth(month);
    employees.forEach(employee => {
      let payrollRecord = state.data.payroll.find(item => item.month === month && item.empId === employee.id);
      if (!payrollRecord) {
        payrollRecord = buildPayrollRecord(month, employee.id, employee.baseSalary);
        state.data.payroll.push(payrollRecord);
      } else if ((payrollRecord.status || "draft") === "draft") {
        payrollRecord.baseSalary = employee.baseSalary;
        recompute(payrollRecord);
      }
    });
    persist();
    requestRefresh("payroll", "dashboard", "today");
    showToast(`已生成 ${month} 薪资（${employees.length} 人）`);
  });

  document.getElementById("csvBtn").addEventListener("click", exportCSV);
  document.getElementById("ratioBtn").addEventListener("click", () => openSettings("payroll"));
  document.getElementById("payMonth").addEventListener("change", renderPayroll);
  document.getElementById("resetPayColBtn").addEventListener("click", resetPayrollColWidths);
}

// #endregion 页面初始化

// #region 薪资表渲染与编辑

export function renderPayroll() {
  const month = document.getElementById("payMonth").value || "2026-08";
  const tableBody = document.querySelector("#payTable tbody");
  const tableFoot = document.querySelector("#payTable tfoot");
  tableBody.innerHTML = "";
  tableFoot.innerHTML = "";

  const employees = employeesForMonth(month);
  if (!employees.length) {
    tableBody.innerHTML = '<tr><td colspan="21"><div class="empty-state"><span class="empty-state-icon">¥</span><div><b>暂无可核算员工</b><p>请先在花名册添加员工并确认任职日期。</p></div></div></td></tr>';
    return;
  }

  // 合计容器
  const totals = { gross: 0, compTotal: 0, persTotal: 0, tax: 0, net: 0, comp: {}, pers: {} };
  COMP_KEYS.forEach(key => { totals.comp[key] = 0; });
  PERS_KEYS.forEach(key => { totals.pers[key] = 0; });

  employees.forEach(employee => {
    let payrollRecord = state.data.payroll.find(item => item.month === month && item.empId === employee.id);
    if (!payrollRecord) payrollRecord = buildPayrollRecord(month, employee.id, employee.baseSalary);
    recomputeDraft(payrollRecord); // 已确认/已发放记录保持核算时的金额快照
    totals.gross += payrollRecord.gross;
    totals.compTotal += payrollRecord.compTotal;
    totals.persTotal += payrollRecord.persTotal;
    totals.tax += payrollRecord.tax;
    totals.net += payrollRecord.net;
    COMP_KEYS.forEach(key => { totals.comp[key] += payrollRecord.comp[key]; });
    PERS_KEYS.forEach(key => { totals.pers[key] += payrollRecord.pers[key]; });

    const companyCells = COMP_KEYS.map(key => `<td class="num mono">${fmtMoney(payrollRecord.comp[key])}</td>`).join("");
    const personalCells = PERS_KEYS.map(key => `<td class="num mono">${fmtMoney(payrollRecord.pers[key])}</td>`).join("");
    const statusOptions = Object.entries(PAYROLL_STATUS).map(([value, label]) => {
      const selected = payrollRecord.status === value ? "selected" : "";
      const disabled = canTransitionPayrollStatus(payrollRecord.status, value) ? "" : "disabled";
      return `<option value="${value}" ${selected} ${disabled}>${label}</option>`;
    }).join("");
    const row = document.createElement("tr");
    row.className = `payroll-row payroll-${payrollRecord.status || "draft"}`;
    row.innerHTML = `
      <td>${escapeHtml(employee.name)}</td><td>${escapeHtml(employee.dept)}</td>
      <td class="num"><input class="p-base" type="number" min="0" value="${payrollRecord.baseSalary}" data-id="${employee.id}" ${payrollRecord.status !== "draft" ? "disabled" : ""}></td>
      <td class="num"><input class="p-travel" type="number" min="0" value="${payrollRecord.travel}" data-id="${employee.id}" ${payrollRecord.status !== "draft" ? "disabled" : ""}></td>
      <td class="num"><input class="p-bonus" type="number" min="0" value="${payrollRecord.bonus}" data-id="${employee.id}" ${payrollRecord.status !== "draft" ? "disabled" : ""}></td>
      <td class="num"><input class="p-ot" type="number" min="0" value="${payrollRecord.overtime}" data-id="${employee.id}" ${payrollRecord.status !== "draft" ? "disabled" : ""}></td>
      <td class="num mono pay-gross-value">${fmtMoney(payrollRecord.gross)}</td>
      ${companyCells}${personalCells}
      <td class="num"><input class="p-tax" type="number" min="0" value="${round2(payrollRecord.tax)}" data-id="${employee.id}" ${payrollRecord.status !== "draft" ? "disabled" : ""} title="${payrollRecord.taxManual ? "人工覆盖" : "演示估算"}"></td>
      <td class="num mono pay-net-value">${fmtMoney(payrollRecord.net)}</td>
      <td><select class="p-status" data-id="${employee.id}" title="状态按草稿 → 已确认 → 已发放流转；解锁需回到草稿">${statusOptions}</select></td>`;
    tableBody.appendChild(row);
  });

  // 合计行
  const totalCompanyCells = COMP_KEYS.map((key, index) => `<td class="num mono ${index === 0 ? "pay-group-start" : ""}">${fmtMoney(totals.comp[key])}</td>`).join("");
  const totalPersonalCells = PERS_KEYS.map((key, index) => `<td class="num mono ${index === 0 ? "pay-group-start" : ""}">${fmtMoney(totals.pers[key])}</td>`).join("");
  tableFoot.innerHTML = `<tr style="font-weight:500;"><td colspan="6">合计</td><td class="num mono pay-group-start">${fmtMoney(totals.gross)}</td>${totalCompanyCells}${totalPersonalCells}<td class="num mono pay-group-start">${fmtMoney(totals.tax)}</td><td class="num mono pay-group-start" style="color:var(--ok)">${fmtMoney(totals.net)}</td><td class="pay-group-start"></td></tr>`;

  // 给每个输入框绑定"修改即重算"
  tableBody.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("change", () => {
      const p = getOrCreatePay(month, inp.dataset.id);
      let amount;
      try {
        amount = requireNonNegativeNumber(inp.value, "金额");
      } catch (error) {
        alert(error.message);
        requestRefresh("payroll");
        return;
      }
      if (inp.classList.contains("p-base")) p.baseSalary = amount;
      else if (inp.classList.contains("p-travel")) p.travel = amount;
      else if (inp.classList.contains("p-bonus")) p.bonus = amount;
      else if (inp.classList.contains("p-ot")) p.overtime = amount;
      else if (inp.classList.contains("p-tax")) { p.tax = amount; p.taxManual = true; }
      recompute(p);
      persist();
      requestRefresh("payroll", "dashboard", "today");
    });
  });
  tableBody.querySelectorAll(".p-status").forEach(sel => sel.addEventListener("change", async () => {
    const p = getOrCreatePay(month, sel.dataset.id);
    if (!canTransitionPayrollStatus(p.status, sel.value)) {
      sel.value = p.status;
      showToast("薪资状态需按“草稿 → 已确认 → 已发放”流转");
      return;
    }
    const requiresUnlock = p.status !== "draft" && sel.value === "draft";
    if (requiresUnlock) {
      const confirmed = await requestConfirm({
        title: "解锁薪资记录",
        message: "改回草稿后可以重新编辑并按当前参数计算。",
        confirmText: "解锁为草稿",
        danger: true
      });
      if (!confirmed) {
        sel.value = p.status;
        return;
      }
    }
    p.status = sel.value;
    persist();
    requestRefresh("payroll", "dashboard", "today");
  }));

  const payrollTable = document.getElementById("payTable");
  enableColResize({
    table: payrollTable,
    widths: normalizeColumnWidths(loadPreference("colw_pay"), PAYROLL_DEFAULT_WIDTHS, { min: 68 }),
    onCommit: widths => savePreference("colw_pay", widths),
    onResized: group => { if (group === 0 || group === 1) syncPayrollSticky(payrollTable); },
    min: 68,
    max: 260
  });
  syncPayrollSticky(payrollTable);
}

function syncPayrollSticky(table) {
  const nameWidth = table.querySelector("thead [data-col='0']")?.getBoundingClientRect().width || 90;
  table.querySelectorAll("thead [data-col='1'], tbody td:nth-child(2)")
    .forEach(element => { element.style.left = nameWidth + "px"; });
}

export function resetPayrollColWidths() {
  removePreference("colw_pay");
  renderPayroll();
}

// #endregion 薪资表渲染与编辑

// #region CSV 导出

// UTF-8 BOM 让常见 Windows Excel 正确识别中文；rowsToCsv 同时处理逗号、引号、
// 换行和公式前缀，不能退回 row.join(",") 的手工拼接。
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
  const csv = "﻿" + rowsToCsv(appendConstantColumn(rows, "核算说明", PAYROLL_DISCLAIMER));
  downloadFile(csv, "薪资_" + month + ".csv", "text/csv");
}

// #endregion CSV 导出
