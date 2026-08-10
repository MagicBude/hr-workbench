// ============================================================
// attendance.js — 考勤记录模块（分时段 + 节假日 + 星期 + 标准表格布局）
// ------------------------------------------------------------
// 页面结构（参照传统考勤表，与"导出 Excel"列一致）：
//   序号 | 姓名 | 部门 | 时段 | 1 2 3 … N(日期) | 出勤 事假 病假 缺勤 调休 年假 加班
//   每个员工占 3 行：上午 / 下午 / 加班；序号/姓名/部门/汇总用 rowspan 合并 3 行。
//   表头两行：第 1 行是日期，第 2 行是星期（节假日显示 休/班）。
// 数据结构：rec = { 1: { am:"√", pm:"√", ot:"" }, ... }（每天上午/下午/加班三时段）
// 交互：点击某时段格，在 √→事→病→缺→调→年→加→空 循环切换。
// 联动：选「调」扣可调休余额（余额不足则【跳过】该状态，不卡死循环，并 toast 提示）；
//       选「加」且开启"加班转调休"时自动增加余额。节假日列自动标色（放假红/调休上班蓝）。
// 布局：用真 <table> + border-collapse，保证横竖线对齐；左侧员工信息列 sticky 固定。
// ============================================================

import { state, persist } from "./store.js";
import { STATUSES, STATUS_COLOR, SHIFTS, SHIFT_LABEL, WEEK_LABEL, HOLIDAYS_2026 } from "./config.js";
import { sumRec } from "./sample.js";
import { openModal, closeModal, showToast } from "./ui.js";

// 汇总列顺序（与表头一致）：出勤 事假 病假 缺勤 调休 年假 加班
const SUM_KEYS = ["出勤", "事假", "病假", "缺勤", "调休", "年假", "加班"];

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
  // 事件委托：整个 tbody 只绑一个点击监听，靠单元格 data-* 定位，性能好、代码简洁
  document.getElementById("attGrid").addEventListener("click", (ev) => {
    const td = ev.target.closest("td.cell");
    if (td) onCellClick(td.dataset);
  });
}

export function renderAttendance() {
  const month = document.getElementById("attMonth").value || "2026-08";
  const wrap = document.getElementById("attGrid");
  const N = daysInMonth(month);
  const emps = state.data.employees;

  if (!emps.length) {
    wrap.innerHTML = '<div class="empty" style="padding:12px;">请先在花名册添加员工</div>';
    return;
  }

  // ---------- 表头第 1 行：日期 ----------
  let h1 = '<th class="st st-seq" rowspan="2">序号</th>'
    + '<th class="st st-name" rowspan="2">姓名</th>'
    + '<th class="st st-dept" rowspan="2">部门</th>'
    + '<th class="st st-shift" rowspan="2">时段</th>';
  // ---------- 表头第 2 行：星期 ----------
  let h2 = "";
  for (let d = 1; d <= N; d++) {
    const hol = holidayOf(month, d);
    const wd = weekdayOf(month, d);
    const isWk = (wd === 0 || wd === 6);
    const cls = hol ? (hol.type === "holiday" ? "hd-holiday" : "hd-workday") : (isWk ? "hd-weekend" : "");
    const title = hol ? ` title="${hol.name}"` : "";
    h1 += `<th class="date ${cls}"${title}>${d}</th>`;                 // 日期数字
    h2 += `<th class="wk ${cls}"${title}>${hol ? (hol.type === "holiday" ? "休" : "班") : WEEK_LABEL[wd]}</th>`; // 星期/休/班
  }
  // 汇总列表头（跨两行）
  SUM_KEYS.forEach(k => { h1 += `<th class="sumcol" rowspan="2">${k}</th>`; });

  // ---------- 表体：每员工 3 行 ----------
  let body = "";
  emps.forEach((e, i) => {
    const rec = getAtt(month, e.id);
    const s = (state.data.attendance.find(x => x.month === month && x.empId === e.id) || {}).summary || sumRec({});
    SHIFTS.forEach((sh, si) => {
      body += "<tr>";
      if (si === 0) {  // 仅"上午"行输出合并的 序号/姓名/部门 与 汇总
        body += `<td class="st st-seq" rowspan="3">${i + 1}</td>`
          + `<td class="st st-name" rowspan="3">${e.name}</td>`
          + `<td class="st st-dept" rowspan="3">${e.dept || ""}</td>`;
      }
      body += `<td class="st st-shift">${SHIFT_LABEL[sh]}</td>`;      // 时段列：上午/下午/加班
      for (let d = 1; d <= N; d++) {                                   // 各日期格
        const hol = holidayOf(month, d);
        const v = rec[d] ? (rec[d][sh] || "") : "";
        const color = v ? ` style="background:${STATUS_COLOR[v].bg};color:${STATUS_COLOR[v].fg}"` : "";
        body += `<td class="cell${hol ? " cell-holiday" : ""}" data-emp="${e.id}" data-day="${d}" data-shift="${sh}"${color}>${v}</td>`;
      }
      if (si === 0) SUM_KEYS.forEach(k => { body += `<td class="sumcol" rowspan="3">${fmt1(s[k])}</td>`; });
      body += "</tr>";
    });
  });

  wrap.innerHTML = `<table class="att-table"><thead><tr>${h1}</tr><tr>${h2}</tr></thead><tbody>${body}</tbody></table>`;
}

// 半天数显示：整数不带小数点，0.5 显示为 0.5
function fmt1(n) { return (n % 1 === 0) ? String(n) : n.toFixed(1); }

// 单元格点击：循环切换状态，并处理调休/加班的余额联动
function onCellClick(ds) {
  const { emp: empId, day, shift } = ds;
  const month = document.getElementById("attMonth").value || "2026-08";
  const emp = state.data.employees.find(x => x.id === empId);
  if (!emp) return;
  const rec = { ...getAtt(month, empId) };                    // 复制 rec，避免直接改原对象
  const cell = { ...(rec[day] || { am: "", pm: "", ot: "" }) }; // 复制该日三时段
  const cur = cell[shift] || "";

  // 状态循环：√ → 事 → 病 → 缺 → 调 → 年 → 加 → (空) → √
  const cycle = [...STATUSES, ""];
  let idx = (cycle.indexOf(cur) + 1) % cycle.length;
  let next = cycle[idx];

  // —— 关键修复：调休余额不足时【跳过】"调"，继续循环到下一个状态 ——
  //    之前的写法是弹窗阻断，导致永远停在"缺"无法继续往后切。现在跳过并 toast 提示。
  const st = state.data.settings || {};
  const half = st.halfDayMinutes || 240;
  if (next === "调" && (emp.restMinutes || 0) < half) {
    showToast(emp.name + " 可调休余额不足（需 " + (half / 60) + " 小时，当前 " + ((emp.restMinutes || 0) / 60).toFixed(1) + " 小时），已跳过「调休」");
    idx = (idx + 1) % cycle.length;
    next = cycle[idx];
  }

  applyRestDelta(emp, cur, next, half, st);   // 应用余额增减（进入/离开 调、加）
  cell[shift] = next;
  rec[day] = cell;
  saveAtt(month, empId, rec);                 // saveAtt 内部已 persist
  window.__renderAll();                        // 刷新所有模块（考勤/花名册余额/今天要处理）
}

// 调休/加班余额增减（调用前已保证「调」余额充足，无需阻断）
function applyRestDelta(emp, from, to, half, st) {
  if (from === "调") emp.restMinutes = (emp.restMinutes || 0) + half;   // 离开调休：释放半天
  if (to === "调") emp.restMinutes = (emp.restMinutes || 0) - half;     // 进入调休：占用半天
  const ratio = st.overtimeToRestRatio || 1;
  if (from === "加" && st.overtimeToRest) emp.restMinutes = (emp.restMinutes || 0) - Math.round(half * ratio); // 离开加班：撤销
  if (to === "加" && st.overtimeToRest) emp.restMinutes = (emp.restMinutes || 0) + Math.round(half * ratio);   // 进入加班：转调休
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
