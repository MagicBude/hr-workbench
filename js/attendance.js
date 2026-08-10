// ============================================================
// attendance.js — 考勤记录模块（Phase 2：分时段 + 节假日 + 星期）
// ------------------------------------------------------------
// 负责：按「月份 × 员工 × 日期 × 时段（上/下/加）」登记考勤状态。
// 数据结构与之前不同：
//   rec = { 1: { am:"√", pm:"√", ot:"" }, ... }   // 每天上午/下午/加班三个时段
// 交互：点击某个时段格，在 √→事→病→缺→调→年→加→空 之间循环切换。
// 联动：选「调」扣减可调休余额（不足则阻止并提示）；选「加」且开启
//       "加班转调休"时自动增加余额。节假日列自动标色（放假红 / 调休上班蓝）。
// ============================================================

import { state, persist } from "./store.js";
import { STATUSES, STATUS_COLOR, SHIFTS, WEEK_LABEL, HOLIDAYS_2026 } from "./config.js";
import { sumRec } from "./sample.js";
import { openModal, closeModal } from "./ui.js";

// 取某员工某月考勤 rec（{day:{am,pm,ot}}），没有则返回空对象
function getAtt(month, empId) {
  const a = state.data.attendance.find(x => x.month === month && x.empId === empId);
  return a ? a.rec : {};
}

// 保存某员工某月考勤：存在则更新，不存在则新建；同时重算汇总
function saveAtt(month, empId, rec) {
  const summary = sumRec(rec);
  const exist = state.data.attendance.find(x => x.month === month && x.empId === empId);
  if (exist) { exist.rec = rec; exist.summary = summary; }
  else state.data.attendance.push({ id: "a_" + month + "_" + empId, month, empId, rec, summary });
  persist();
}

// 该月实际天数（如 2026-02 → 28）
function daysInMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}
// 某天的节假日信息（{name,type:"holiday"|"workday"} 或 null）
function holidayOf(month, day) {
  const date = month + "-" + String(day).padStart(2, "0");
  return (state.data.holidays || {})[date] || null;
}
// 该月某日是星期几（0=周日）
function weekdayOf(month, day) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, day).getDay();
}

export function initAttendance() {
  document.getElementById("attMonth").addEventListener("change", renderAttendance);
  document.getElementById("holidayBtn").addEventListener("click", openHolidayModal);
}

export function renderAttendance() {
  const month = document.getElementById("attMonth").value || "2026-08";
  const wrap = document.getElementById("attGrid");
  wrap.innerHTML = "";
  const N = daysInMonth(month);
  const emps = state.data.employees;

  // 空提示
  if (!emps.length) {
    const d = document.createElement("div");
    d.className = "empty"; d.style.padding = "12px";
    d.textContent = "请先在花名册添加员工";
    wrap.appendChild(d);
    return;
  }

  // —— 左侧：员工列（固定）——
  const colEmp = el("div", "col-emp");
  colEmp.appendChild(el("div", "head-emp", "员工"));
  emps.forEach(e => {
    const r = el("div", "emp-row");
    r.innerHTML = `<div class="emp-name">${e.name}</div><div class="emp-dept">${e.dept || ""}</div><div class="emp-shifts">上 / 下 / 加</div>`;
    colEmp.appendChild(r);
  });
  wrap.appendChild(colEmp);

  // —— 中间：每个日期一列（含日期 + 星期 + 每员工三行时段）——
  for (let d = 1; d <= N; d++) {
    const hol = holidayOf(month, d);
    const wd = weekdayOf(month, d);
    const isWeekend = (wd === 0 || wd === 6);
    const col = el("div", "col-day");

    // 表头第 1 行：日期；第 2 行：星期（节假日显示 休/班）
    const hd = el("div", "head-day", String(d));
    const hw = el("div", "head-week", hol ? (hol.type === "holiday" ? "休" : "班") : WEEK_LABEL[wd]);
    const hdCls = hol ? (hol.type === "holiday" ? "hd-holiday" : "hd-workday") : (isWeekend ? "hd-weekend" : "");
    if (hdCls) { hd.classList.add(hdCls); hw.classList.add(hdCls); }
    if (hol) { hd.title = hol.name; hw.title = hol.name; }   // 悬停显示节假日名
    col.appendChild(hd); col.appendChild(hw);

    // 该日期下，每员工三个时段
    emps.forEach(e => {
      const rec = getAtt(month, e.id);
      const cells = el("div", "cells");
      SHIFTS.forEach(sh => {
        const c = el("div", "cell");
        c.dataset.emp = e.id; c.dataset.day = d; c.dataset.shift = sh;
        const v = rec[d] ? rec[d][sh] : "";
        if (v) { c.textContent = v; c.style.background = STATUS_COLOR[v].bg; c.style.color = STATUS_COLOR[v].fg; }
        if (hol) c.classList.add("cell-holiday");
        c.addEventListener("click", onCellClick);
        cells.appendChild(c);
      });
      col.appendChild(cells);
    });
    wrap.appendChild(col);
  }

  // —— 右侧：汇总列（固定）——
  const colSum = el("div", "col-sum");
  colSum.appendChild(el("div", "head-sum", "汇总"));
  emps.forEach(e => {
    const a = state.data.attendance.find(x => x.month === month && x.empId === e.id);
    const s = a ? a.summary : sumRec({});
    const r = el("div", "sum-row");
    r.innerHTML = `<div class="sum-line">出勤 <b>${fmt1(s.出勤)}</b> 天</div>
      <div class="sum-line">事 ${fmt1(s.事假)} · 病 ${fmt1(s.病假)} · 缺 ${fmt1(s.缺勤)}</div>
      <div class="sum-line">调 ${fmt1(s.调休)} · 年 ${fmt1(s.年假)} · 加 ${s.加班}</div>`;
    colSum.appendChild(r);
  });
  wrap.appendChild(colSum);
}

// 半天数显示：整数不带小数点，0.5 显示为 0.5
function fmt1(n) { return (n % 1 === 0) ? String(n) : n.toFixed(1); }

// 单元格点击：循环切换状态，并处理调休/加班的余额联动
function onCellClick(ev) {
  const { emp: empId, day, shift } = ev.currentTarget.dataset;
  const month = document.getElementById("attMonth").value || "2026-08";
  const emp = state.data.employees.find(x => x.id === empId);
  if (!emp) return;
  const rec = { ...getAtt(month, empId) };                    // 复制 rec，避免直接改原对象
  const cell = { ...(rec[day] || { am: "", pm: "", ot: "" }) }; // 复制该日三时段
  const cur = cell[shift] || "";

  // 状态循环：√ → 事 → 病 → 缺 → 调 → 年 → 加 → (空) → √
  const cycle = [...STATUSES, ""];
  const idx = (cycle.indexOf(cur) + 1) % cycle.length;
  const next = cycle[idx];

  // —— 调休 / 加班 余额联动（余额不足则中止本次切换）——
  const st = state.data.settings || {};
  const half = st.halfDayMinutes || 240;
  if (!applyRestDelta(emp, cur, next, half, st)) return;

  cell[shift] = next;
  rec[day] = cell;
  saveAtt(month, empId, rec);   // saveAtt 内部已 persist
  window.__renderAll();          // 刷新所有模块（考勤/花名册余额/今天要处理）
}

// 调休/加班余额增减；返回 false 表示中止切换
function applyRestDelta(emp, from, to, half, st) {
  if (from === "调") emp.restMinutes = (emp.restMinutes || 0) + half;          // 离开调休：释放半天
  if (to === "调") {                                                          // 进入调休：占用半天
    if ((emp.restMinutes || 0) < half) {
      alert(emp.name + " 可调休余额不足（需 " + (half / 60) + " 小时，当前 " + ((emp.restMinutes || 0) / 60).toFixed(1) + " 小时）");
      return false;
    }
    emp.restMinutes -= half;
  }
  const ratio = st.overtimeToRestRatio || 1;
  if (from === "加" && st.overtimeToRest) emp.restMinutes = (emp.restMinutes || 0) - Math.round(half * ratio); // 离开加班：撤销
  if (to === "加" && st.overtimeToRest) emp.restMinutes = (emp.restMinutes || 0) + Math.round(half * ratio);   // 进入加班：转调休
  return true;
}

// 工具：建元素
function el(tag, cls, text) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (text != null) d.textContent = text;
  return d;
}

// ---------- 节假日设置弹窗 ----------
function openHolidayModal() {
  const month = document.getElementById("attMonth").value || "2026-08";
  const N = daysInMonth(month);
  const holidays = state.data.holidays || {};
  let rows = "";
  for (let d = 1; d <= N; d++) {
    const date = month + "-" + String(d).padStart(2, "0");
    const h = holidays[date];
    rows += `<tr><td>${date} 周${WEEK_LABEL[weekdayOf(month, d)]}</td>
      <td>${h ? h.name : "-"}</td>
      <td>${h ? (h.type === "holiday" ? "放假" : "调休上班") : "-"}</td>
      <td class="ops">
        <button class="btn btn-sm" data-hol="${date}">放假</button>
        <button class="btn btn-sm" data-work="${date}">上班</button>
        ${h ? `<button class="btn btn-sm btn-danger" data-clear="${date}">清除</button>` : ""}
      </td></tr>`;
  }
  openModal(`
    <h3>节假日设置 · ${month}</h3>
    <div class="row">
      <button class="btn btn-primary" id="resetHol">重置为 2026 国家法定节假日</button>
    </div>
    <div class="hint" style="margin-bottom:10px;">「放假」不计出勤（列标红）；「上班」为调休上班日（列标蓝）；「清除」恢复普通日。老板临时多放的假可直接点「放假」。</div>
    <div style="overflow:auto; max-height:52vh;"><table>
      <thead><tr><th>日期</th><th>名称</th><th>类型</th><th>操作</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="modal-actions"><button class="btn" id="holClose">完成</button></div>`);
  document.getElementById("holClose").addEventListener("click", closeModal);
  document.getElementById("resetHol").addEventListener("click", () => {
    state.data.holidays = { ...HOLIDAYS_2026 };
    persist(); closeModal(); window.__renderAll();
  });
  document.querySelectorAll("[data-hol]").forEach(b => b.addEventListener("click", () => setHoliday(b.dataset.hol, "holiday")));
  document.querySelectorAll("[data-work]").forEach(b => b.addEventListener("click", () => setHoliday(b.dataset.work, "workday")));
  document.querySelectorAll("[data-clear]").forEach(b => b.addEventListener("click", () => clearHoliday(b.dataset.clear)));
}
function setHoliday(date, type) {
  const name = prompt("节假日名称（可留空）", "") || (type === "holiday" ? "放假" : "调休上班");
  state.data.holidays = state.data.holidays || {};
  state.data.holidays[date] = { name, type };
  persist(); closeModal(); window.__renderAll();
}
function clearHoliday(date) {
  delete state.data.holidays[date];
  persist(); closeModal(); window.__renderAll();
}
