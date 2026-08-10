// ============================================================
// payroll.js — 薪资核算模块
// ------------------------------------------------------------
// 负责：按“月份”为每位员工生成薪资，自动算五险一金/个税/实发，
//        并支持手动修改与导出 CSV。
// 计算都在 sample.js 的 buildPayroll() 和本文件的 recompute() 里。
// ============================================================

import { state, persist } from "./store.js";
import { fmtMoney, downloadFile } from "./ui.js";
import { buildPayroll } from "./sample.js";
import { INSURANCE_RATIO, BIG_SICKNESS, TAX_THRESHOLD, TAX_RATE } from "./config.js";

// 取某员工某月工资记录；没有就按基本月薪新建一条（方便后续编辑）
function getOrCreatePay(month, empId) {
  let p = state.data.payroll.find(x => x.month === month && x.empId === empId);
  if (!p) {
    const e = state.data.employees.find(x => x.id === empId);
    p = buildPayroll(month, empId, e ? e.baseSalary : 0, 0, 0, 0);
    state.data.payroll.push(p);
  }
  return p;
}

// 根据当前输入重新计算：五险一金、个税、实发
function recompute(p) {
  const c = INSURANCE_RATIO.company, pc = INSURANCE_RATIO.personal;
  p.comp = {
    养老: p.baseSalary * c.养老, 医疗: p.baseSalary * c.医疗, 工伤: p.baseSalary * c.工伤,
    失业: p.baseSalary * c.失业, 生育: p.baseSalary * c.生育, 公积金: p.baseSalary * c.公积金
  };
  p.pers = {
    养老: p.baseSalary * pc.养老, 医疗: p.baseSalary * pc.医疗, 失业: p.baseSalary * pc.失业,
    公积金: p.baseSalary * pc.公积金, 大病医疗: BIG_SICKNESS
  };
  p.gross = p.baseSalary + p.travel + p.bonus + p.overtime;                 // 本月应发
  p.persTotal = p.pers.养老 + p.pers.医疗 + p.pers.失业 + p.pers.公积金 + p.pers.大病医疗;
  p.net = p.gross - p.persTotal - p.tax;                                   // 实发
}
function round2(n) { return Math.round(n * 100) / 100; }

export function initPayroll() {
  // “生成/刷新薪资”：对当前月份每位员工确保有一条薪资记录
  document.getElementById("genPayBtn").addEventListener("click", () => {
    const month = document.getElementById("payMonth").value || "2026-08";
    state.data.employees.forEach(e => {
      let p = state.data.payroll.find(x => x.month === month && x.empId === e.id);
      if (!p) { p = buildPayroll(month, e.id, e.baseSalary, 0, 0, 0); state.data.payroll.push(p); }
      else { p.baseSalary = e.baseSalary; p.travel = p.travel || 0; p.bonus = p.bonus || 0; p.overtime = p.overtime || 0; recompute(p); }
    });
    persist();
    window.__renderAll();
    alert("已生成 " + month + " 薪资（" + state.data.employees.length + " 人）");
  });

  document.getElementById("csvBtn").addEventListener("click", exportCSV);
  document.getElementById("payMonth").addEventListener("change", renderPayroll);
}

export function renderPayroll() {
  const month = document.getElementById("payMonth").value || "2026-08";
  const tb = document.querySelector("#payTable tbody");
  const tf = document.querySelector("#payTable tfoot");
  tb.innerHTML = ""; tf.innerHTML = "";

  if (!state.data.employees.length) {
    tb.innerHTML = '<tr><td colspan="10" class="empty">请先在花名册添加员工。</td></tr>';
    return;
  }

  let totGross = 0, totPers = 0, totTax = 0, totNet = 0;
  state.data.employees.forEach(e => {
    let p = state.data.payroll.find(x => x.month === month && x.empId === e.id);
    if (!p) p = buildPayroll(month, e.id, e.baseSalary, 0, 0, 0);
    totGross += p.gross; totPers += p.persTotal; totTax += p.tax; totNet += p.net;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${e.name}</td><td>${e.dept}</td>
      <td class="num"><input class="p-base" type="number" min="0" value="${p.baseSalary}" data-id="${e.id}" style="width:90px"></td>
      <td class="num"><input class="p-travel" type="number" min="0" value="${p.travel}" data-id="${e.id}" style="width:80px"></td>
      <td class="num"><input class="p-bonus" type="number" min="0" value="${p.bonus}" data-id="${e.id}" style="width:80px"></td>
      <td class="num"><input class="p-ot" type="number" min="0" value="${p.overtime}" data-id="${e.id}" style="width:80px"></td>
      <td class="num mono">${fmtMoney(p.gross)}</td>
      <td class="num mono">${fmtMoney(p.persTotal)}</td>
      <td class="num"><input class="p-tax" type="number" min="0" value="${round2(p.tax)}" data-id="${e.id}" style="width:80px"></td>
      <td class="num mono" style="color:var(--ok)">${fmtMoney(p.net)}</td>`;
    tb.appendChild(tr);
  });

  // 合计行
  tf.innerHTML = `<tr style="font-weight:500;"><td colspan="6" class="num">合计</td>
    <td class="num mono">${fmtMoney(totGross)}</td><td class="num mono">${fmtMoney(totPers)}</td>
    <td class="num mono">${fmtMoney(totTax)}</td><td class="num mono" style="color:var(--ok)">${fmtMoney(totNet)}</td></tr>`;

  // 给每个输入框绑定“修改即重算”
  tb.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("change", () => {
      const id = inp.dataset.id;
      const p = getOrCreatePay(month, id);
      if (inp.classList.contains("p-base")) p.baseSalary = +inp.value || 0;
      else if (inp.classList.contains("p-travel")) p.travel = +inp.value || 0;
      else if (inp.classList.contains("p-bonus")) p.bonus = +inp.value || 0;
      else if (inp.classList.contains("p-ot")) p.overtime = +inp.value || 0;
      else if (inp.classList.contains("p-tax")) p.tax = +inp.value || 0;
      recompute(p);
      persist();
      window.__renderAll();
    });
  });
}

// 导出 CSV：带 BOM(\uFEFF) 让 Excel 正确显示中文
function exportCSV() {
  const month = document.getElementById("payMonth").value || "2026-08";
  const rows = [["姓名", "部门", "基本月薪", "出差补贴", "奖金", "加班费", "本月应发",
    "个人养老", "个人医疗", "个人失业", "个人公积金", "大病医疗", "个税", "实发薪资"]];
  state.data.employees.forEach(e => {
    let p = state.data.payroll.find(x => x.month === month && x.empId === e.id);
    if (!p) p = buildPayroll(month, e.id, e.baseSalary, 0, 0, 0);
    rows.push([e.name, e.dept, p.baseSalary, p.travel, p.bonus, p.overtime, round2(p.gross),
      round2(p.pers.养老), round2(p.pers.医疗), round2(p.pers.失业), round2(p.pers.公积金), p.pers.大病医疗, round2(p.tax), round2(p.net)]);
  });
  const csv = "﻿" + rows.map(r => r.join(",")).join("\n");
  downloadFile(csv, "薪资_" + month + ".csv", "text/csv");
}
