// ============================================================
// attendance.js — 考勤记录模块（分时段 + 节假日 + 星期 + 标准表格布局）
// ------------------------------------------------------------
// 页面结构（参照传统考勤表，与"导出 Excel"列一致）：
//   序号 | 姓名 | 部门 | 时段 | 1 2 3 … N(日期) | 出勤 事假 病假 缺勤 调休 年假 加班
//   每个员工占 3 行：上午 / 下午 / 加班；序号/姓名/部门/汇总用 rowspan 合并 3 行。
//   表头两行：第 1 行是日期，第 2 行是星期（节假日显示 休/班）。
// 数据结构：rec = { 1: { am:"√", pm:"√", ot:"" }, ... }（每天上午/下午/加班三时段）
// 交互：点击某时段格循环切换。普通工作日上午/下午：√→事→病→缺→调→年→空；周末/节假日上午/下午可走完整循环（含「加」）；加班行：加↔空。
// 联动：选「调」扣可调休余额（余额不足则【跳过】该状态，不卡死循环，并 toast 提示）；
//       选「加」且开启"加班转调休"时自动增加余额。节假日列自动标色（放假红/调休上班蓝）。
// 布局：用真 <table> + border-collapse，保证横竖线对齐；左侧员工信息列 sticky 固定。
// ============================================================

import { state, persist, getDepartments } from "./store.js";
import { STORAGE_PREFIX, STATUSES, STATUS_COLOR, SHIFTS, SHIFT_LABEL, WEEK_LABEL, HOLIDAYS_2026 } from "./config.js";
import { sumRec } from "./sample.js";
import { openModal, closeModal, showToast, enableColResize } from "./ui.js";

// 汇总列顺序（与表头一致）：出勤 事假 病假 缺勤 调休 年假 加班
const SUM_KEYS = ["出勤", "事假", "病假", "缺勤", "调休", "年假", "加班"];

// 考勤筛选（仅内存）：按姓名模糊匹配 + 按部门精确匹配
let attFilter = { name: "", dept: "" };

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
  // 筛选：姓名 + 部门（与花名册共享组织级部门列表）
  const fn = document.getElementById("attFilterName");
  const fd = document.getElementById("attFilterDept");
  fd.innerHTML = '<option value="">全部部门</option>'
    + getDepartments().map(d => `<option value="${escAttr(d)}">${escAttr(d)}</option>`).join("");
  fn.addEventListener("input", () => { attFilter.name = fn.value; renderAttendance(); });
  fd.addEventListener("change", () => { attFilter.dept = fd.value; renderAttendance(); });
  // 事件委托：整个 tbody 只绑一个点击监听，靠单元格 data-* 定位，性能好、代码简洁
  document.getElementById("attGrid").addEventListener("click", (ev) => {
    const td = ev.target.closest("td.cell");
    if (td) onCellClick(td.dataset);
  });
}

// 小工具：转义（与 roster.js 同款，避免部门名破坏 HTML）
function escAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderAttendance() {
  const month = document.getElementById("attMonth").value || "2026-08";
  const wrap = document.getElementById("attGrid");
  const N = daysInMonth(month);

  // 应用筛选：姓名模糊匹配 + 部门精确匹配
  const all = state.data.employees;
  const q = attFilter.name.trim().toLowerCase();
  const emps = all.filter(e =>
    (!q || e.name.toLowerCase().includes(q)) &&
    (!attFilter.dept || e.dept === attFilter.dept)
  );
  const cnt = document.getElementById("attFilterCount");
  if (cnt) cnt.textContent = `共 ${emps.length} / ${all.length} 人`;

  // 切换组织后，原筛选的部门可能已不存在 → 自动清空，避免整表空白
  if (attFilter.dept && !getDepartments().includes(attFilter.dept)) {
    attFilter.dept = "";
    const fd = document.getElementById("attFilterDept");
    if (fd) fd.value = "";
  }

  if (!all.length) {
    wrap.innerHTML = '<div class="empty" style="padding:12px;">请先在花名册添加员工</div>';
    return;
  }
  if (!emps.length) {
    wrap.innerHTML = '<div class="empty" style="padding:12px;">没有匹配的员工</div>';
    return;
  }

  // ---------- 表头第 1 行：日期 ----------
  let h1 = '<th class="st st-seq" rowspan="2" data-col="0">序号</th>'
    + '<th class="st st-name" rowspan="2" data-col="1">姓名</th>'
    + '<th class="st st-dept" rowspan="2" data-col="2">部门</th>'
    + '<th class="st st-shift" rowspan="2" data-col="3">时段</th>';
  // ---------- 表头第 2 行：星期 ----------
  let h2 = "";
  for (let d = 1; d <= N; d++) {
    const hol = holidayOf(month, d);
    const wd = weekdayOf(month, d);
    const isWk = (wd === 0 || wd === 6);
    const cls = hol ? (hol.type === "holiday" ? "hd-holiday" : "hd-workday") : (isWk ? "hd-weekend" : "");
    const title = hol ? ` title="${hol.name}"` : "";
    const dc = 3 + d;   // 日期列序号：4..(4+N-1)
    h1 += `<th class="date ${cls}" data-col="${dc}"${title}>${d}</th>`;                 // 日期数字
    h2 += `<th class="wk ${cls}" data-col="${dc}"${title}>${hol ? (hol.type === "holiday" ? "休" : "班") : WEEK_LABEL[wd]}</th>`; // 星期/休/班
  }
  // 汇总列表头（跨两行）
  SUM_KEYS.forEach((k, j) => { h1 += `<th class="sumcol" rowspan="2" data-col="${4 + N + j}">${k}</th>`; });

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

  // 启用列宽拖拽：固定列逐列、日期列与汇总列分别"整组统一"调；同步 sticky 偏移
  const table = wrap.querySelector("table");
  enableColResize({
    table,
    widths: attWidths(N),
    group: (i) => i < 4 ? "f" + i : (i < 4 + N ? "date" : "sum"),
    onCommit: (w) => saveAttWidths(w, N),
    onResized: () => syncAttSticky(table),
    min: 26
  });
  syncAttSticky(table);   // 初次渲染也要按实际列宽定位 sticky 列
}

// 列宽持久化（按组织）：花名册用一维数组；考勤用 {fixed,date,sum}（日期/汇总整组同宽）
function colwKey(tag) { return STORAGE_PREFIX + state.current + "_colw_" + tag; }
function loadColW(tag) { try { return JSON.parse(localStorage.getItem(colwKey(tag))); } catch { return null; } }
function saveColW(tag, w) { localStorage.setItem(colwKey(tag), JSON.stringify(w)); }

// 恢复默认列宽：清除记忆并刷新
export function resetAttColWidths() {
  localStorage.removeItem(colwKey("att"));
  renderAttendance();
}
// 由存储的 {fixed,date,sum} 展开成每列宽度数组（长度 = 4 + N + 7）
function attWidths(N) {
  const s = loadColW("att") || {};
  const fixed = (s.fixed && s.fixed.length === 4) ? s.fixed : [36, 70, 70, 44];
  const date = s.date || 32;
  const sum = s.sum || 34;
  const arr = [];
  for (let i = 0; i < 4; i++) arr.push(fixed[i]);
  for (let i = 0; i < N; i++) arr.push(date);
  for (let i = 0; i < 7; i++) arr.push(sum);
  return arr;
}
function saveAttWidths(w, N) {
  saveColW("att", { fixed: [w[0], w[1], w[2], w[3]], date: w[4], sum: w[4 + N] });
}
// 重算左侧 sticky 固定列的 left 偏移（按"实际渲染宽度"累加，兼容表格整体 100% 拉伸）
function syncAttSticky(table) {
  const classes = ["st-seq", "st-name", "st-dept", "st-shift"];
  let left = 0;
  classes.forEach(cls => {
    const cell = table.querySelector("thead ." + cls);
    const w = cell ? cell.getBoundingClientRect().width : 0;
    table.querySelectorAll("." + cls).forEach(el => { el.style.left = left + "px"; });
    left += w;
  });
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

  // 根据时段与日期类型决定可循环状态：
  //   - 加班行（ot）只能「加 / 空」切换；
  //   - 上午/下午行（am/pm）在普通工作日不能选「加」，循环 √→事→病→缺→调→年→空；
  //   - 上午/下午行在周末或节假日放假时允许「加」（来上班算加班），走完整循环 √→事→病→缺→调→年→加→空。
  const d = Number(day);
  const wd = weekdayOf(month, d);
  const hol = holidayOf(month, d);
  const isRestDay = (wd === 0 || wd === 6) || (hol && hol.type === "holiday"); // 周末或节假日放假
  const isOt = shift === "ot";
  const canOvertime = isOt || isRestDay;
  const cycle = canOvertime ? [...STATUSES, ""] : ["√", "事", "病", "缺", "调", "年", ""];
  let idx = (cycle.indexOf(cur) + 1) % cycle.length;
  let next = cycle[idx];

  // —— 关键修复：普通行调休余额不足时【跳过】"调"，继续循环到下一个状态 ——
  //    之前的写法是弹窗阻断，导致永远停在"缺"无法继续往后切。现在跳过并 toast 提示。
  const st = state.data.settings || {};
  const half = st.halfDayMinutes || 240;
  if (!isOt && next === "调" && (emp.restMinutes || 0) < half) {
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
