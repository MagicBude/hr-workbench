// ============================================================
// payroll.js — 薪资核算模块（Phase 3：缴纳明细 + 比例设置）
// ------------------------------------------------------------
// 负责：按「月份」为每位员工生成薪资，自动算五险一金/个税/实发，
//        支持手动修改、展示公司/个人缴纳分项、设置组织比例，并可导出 CSV。
// 计算基数：员工设置了 insuranceBase 就用它，否则用薪资的基本月薪。
// 计算比例：settings.insuranceRatio（组织级，可在"比例设置"弹窗里改）。
// ============================================================

import { state, persist } from "./store.js";
import { fmtMoney, downloadFile, openModal, closeModal } from "./ui.js";
import { buildPayroll } from "./sample.js";
import { INSURANCE_RATIO, BIG_SICKNESS } from "./config.js";

// 公司缴纳 / 个人缴纳的项目顺序（与表头一致）
const COMP_KEYS = ["养老", "医疗", "工伤", "失业", "生育", "公积金"];
const PERS_KEYS = ["养老", "医疗", "失业", "公积金", "大病医疗"];

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

// 重新计算五险一金、个税、实发
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
  p.net = p.gross - p.persTotal - p.tax;                       // 实发
}
function round2(n) { return Math.round(n * 100) / 100; }

export function initPayroll() {
  // "生成/刷新薪资"：对当前月份每位员工确保有一条薪资记录
  document.getElementById("genPayBtn").addEventListener("click", () => {
    const month = document.getElementById("payMonth").value || "2026-08";
    state.data.employees.forEach(e => {
      let p = state.data.payroll.find(x => x.month === month && x.empId === e.id);
      if (!p) { p = buildPayroll(month, e.id, e.baseSalary, 0, 0, 0); state.data.payroll.push(p); }
      else { p.baseSalary = e.baseSalary; recompute(p); }
    });
    persist();
    window.__renderAll();
    alert("已生成 " + month + " 薪资（" + state.data.employees.length + " 人）");
  });

  document.getElementById("csvBtn").addEventListener("click", exportCSV);
  document.getElementById("ratioBtn").addEventListener("click", openRatioModal);
  document.getElementById("payMonth").addEventListener("change", renderPayroll);
}

export function renderPayroll() {
  const month = document.getElementById("payMonth").value || "2026-08";
  const tb = document.querySelector("#payTable tbody");
  const tf = document.querySelector("#payTable tfoot");
  tb.innerHTML = ""; tf.innerHTML = "";

  if (!state.data.employees.length) {
    tb.innerHTML = '<tr><td colspan="20" class="empty">请先在花名册添加员工。</td></tr>';
    return;
  }

  // 合计容器
  const tot = { gross: 0, compTotal: 0, persTotal: 0, tax: 0, net: 0, comp: {}, pers: {} };
  COMP_KEYS.forEach(k => tot.comp[k] = 0);
  PERS_KEYS.forEach(k => tot.pers[k] = 0);

  state.data.employees.forEach(e => {
    let p = state.data.payroll.find(x => x.month === month && x.empId === e.id);
    if (!p) p = buildPayroll(month, e.id, e.baseSalary, 0, 0, 0);
    recompute(p); // 渲染时重算，保证与最新比例/基数一致
    tot.gross += p.gross; tot.compTotal += p.compTotal; tot.persTotal += p.persTotal;
    tot.tax += p.tax; tot.net += p.net;
    COMP_KEYS.forEach(k => tot.comp[k] += p.comp[k]);
    PERS_KEYS.forEach(k => tot.pers[k] += p.pers[k]);

    const compCells = COMP_KEYS.map(k => `<td class="num mono">${fmtMoney(p.comp[k])}</td>`).join("");
    const persCells = PERS_KEYS.map(k => `<td class="num mono">${fmtMoney(p.pers[k])}</td>`).join("");
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${e.name}</td><td>${e.dept}</td>
      <td class="num"><input class="p-base" type="number" min="0" value="${p.baseSalary}" data-id="${e.id}"></td>
      <td class="num"><input class="p-travel" type="number" min="0" value="${p.travel}" data-id="${e.id}"></td>
      <td class="num"><input class="p-bonus" type="number" min="0" value="${p.bonus}" data-id="${e.id}"></td>
      <td class="num"><input class="p-ot" type="number" min="0" value="${p.overtime}" data-id="${e.id}"></td>
      <td class="num mono">${fmtMoney(p.gross)}</td>
      ${compCells}${persCells}
      <td class="num"><input class="p-tax" type="number" min="0" value="${round2(p.tax)}" data-id="${e.id}"></td>
      <td class="num mono" style="color:var(--ok)">${fmtMoney(p.net)}</td>`;
    tb.appendChild(tr);
  });

  // 合计行
  const totCompCells = COMP_KEYS.map(k => `<td class="num mono">${fmtMoney(tot.comp[k])}</td>`).join("");
  const totPersCells = PERS_KEYS.map(k => `<td class="num mono">${fmtMoney(tot.pers[k])}</td>`).join("");
  tf.innerHTML = `<tr style="font-weight:500;"><td colspan="6">合计</td><td class="num mono">${fmtMoney(tot.gross)}</td>${totCompCells}${totPersCells}<td class="num mono">${fmtMoney(tot.tax)}</td><td class="num mono" style="color:var(--ok)">${fmtMoney(tot.net)}</td></tr>`;

  // 给每个输入框绑定"修改即重算"
  tb.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("change", () => {
      const p = getOrCreatePay(month, inp.dataset.id);
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

// ---------- 社保公积金比例设置弹窗 ----------
function openRatioModal() {
  const r = ratioOf();
  const c = r.company, p = r.personal;
  const compInputs = COMP_KEYS.map(k =>
    `<div class="field"><label>${k}</label><input class="rc" data-k="${k}" type="number" step="0.001" min="0" value="${c[k]}"></div>`).join("");
  const persInputs = PERS_KEYS.filter(k => k !== "大病医疗").map(k =>
    `<div class="field"><label>${k}</label><input class="rp" data-k="${k}" type="number" step="0.001" min="0" value="${p[k]}"></div>`).join("");
  openModal(`
    <h3>社保公积金比例设置</h3>
    <div class="hint" style="margin-bottom:10px;">以「社保基数」按比例计算（基数默认=基本月薪，可在员工编辑里单独设置）。比例为小数，如 0.16 = 16%。</div>
    <div class="grp-title">公司缴纳</div>
    <div class="ratio-grid">${compInputs}</div>
    <div class="grp-title">个人缴纳</div>
    <div class="ratio-grid">
      ${persInputs}
      <div class="field"><label>大病医疗(元/月)</label><input class="rb" type="number" min="0" value="${bigSickness()}"></div>
    </div>
    <div class="modal-actions">
      <button class="btn" id="ratioCancel">取消</button>
      <button class="btn" id="ratioReset">恢复默认</button>
      <button class="btn btn-primary" id="ratioSave">保存</button>
    </div>`);
  document.getElementById("ratioCancel").addEventListener("click", closeModal);
  document.getElementById("ratioReset").addEventListener("click", () => {
    state.data.settings = state.data.settings || {};
    state.data.settings.insuranceRatio = JSON.parse(JSON.stringify(INSURANCE_RATIO));
    state.data.settings.bigSickness = BIG_SICKNESS;
    persist(); closeModal(); window.__renderAll();
  });
  document.getElementById("ratioSave").addEventListener("click", () => {
    state.data.settings = state.data.settings || {};
    const nr = { company: {}, personal: {} };
    document.querySelectorAll(".rc").forEach(i => nr.company[i.dataset.k] = +i.value || 0);
    document.querySelectorAll(".rp").forEach(i => nr.personal[i.dataset.k] = +i.value || 0);
    state.data.settings.insuranceRatio = nr;
    state.data.settings.bigSickness = +document.querySelector(".rb").value || BIG_SICKNESS;
    persist(); closeModal(); window.__renderAll();
  });
}

// 导出 CSV：带 BOM(﻿) 让 Excel 正确显示中文（含公司/个人缴纳分项）
function exportCSV() {
  const month = document.getElementById("payMonth").value || "2026-08";
  const head = ["姓名", "部门", "基本月薪", "出差补贴", "奖金", "加班费", "本月应发",
    "公司养老", "公司医疗", "公司工伤", "公司失业", "公司生育", "公司公积金",
    "个人养老", "个人医疗", "个人失业", "个人公积金", "大病医疗", "个税", "实发薪资"];
  const rows = [head];
  state.data.employees.forEach(e => {
    let p = state.data.payroll.find(x => x.month === month && x.empId === e.id);
    if (!p) p = buildPayroll(month, e.id, e.baseSalary, 0, 0, 0);
    recompute(p);
    rows.push([e.name, e.dept, p.baseSalary, p.travel, p.bonus, p.overtime, round2(p.gross),
      ...COMP_KEYS.map(k => round2(p.comp[k])),
      ...PERS_KEYS.map(k => round2(p.pers[k])),
      round2(p.tax), round2(p.net)]);
  });
  const csv = "﻿" + rows.map(r => r.join(",")).join("\n");
  downloadFile(csv, "薪资_" + month + ".csv", "text/csv");
}
