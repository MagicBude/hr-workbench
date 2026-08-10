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

import { state, persist, getDepartments, computeRestMinutes } from "./store.js";
import { STORAGE_PREFIX, STATUSES, STATUS_LABEL, STATUS_COLOR, SHIFTS, SHIFT_LABEL, WEEK_LABEL, HOLIDAYS_2026, SUM_KEYS, HALF_DAY_MINUTES } from "./config.js";
import { sumRec } from "./sample.js";
import { openModal, closeModal, showToast, enableColResize } from "./ui.js";

// ---------- 时长相关：可带时长的状态 ----------
// 除出勤√外，其它状态都支持填分钟：
//   - 调/年/事/病/缺：整段请假默认按半天(240 分钟)，可改为任意分钟（如请 2 小时）
//   - 加：加班，默认 1 小时（用户选择），可按分钟调
//   - 迟/退：迟到/早退，默认 30 分钟
function isDurationStatus(s) { return s && s !== "√"; }
function defaultMinFor(s) {
  const half = (state.data.settings && state.data.settings.halfDayMinutes) || HALF_DAY_MINUTES;
  if (s === "加") return 60;
  if (s === "迟" || s === "退") return 30;
  return half; // 调/年/事/病/缺 整段按半天
}
// 把单元格值（字符串 或 {s,min}）解析成展示所需 {s,min,color}
function cellView(v) {
  const s = (v && typeof v === "object") ? v.s : v;
  const min = (v && typeof v === "object" && v.min != null) ? v.min : null;
  const color = s ? STATUS_COLOR[s] : null;
  return { s: s || "", min, color };
}
// 分钟 → 简短文案：240→"4h"，60→"1h"，30→"30m"，90→"1h30m"
function fmtMin(m) {
  m = Math.round(m || 0);
  if (m <= 0) return "0m";
  if (m % 60 === 0) return (m / 60) + "h";
  if (m < 60) return m + "m";
  return Math.floor(m / 60) + "h" + (m % 60) + "m";
}

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
// 某天是否为“工作日”（需要考勤）。
//   - 节假日设置里 type:"workday"（调休上班）→ 工作日；type:"holiday"（放假）→ 非工作日
//   - 普通日：周一~周五=工作日，周六日=非工作日
export function isWorkday(month, day) {
  const hol = holidayOf(month, day);
  if (hol) return hol.type === "workday";
  const wd = weekdayOf(month, day);
  return wd !== 0 && wd !== 6;
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
  // 事件委托：单击循环切换 + 拖拽框选批量应用 + 时长角标
  const grid = document.getElementById("attGrid");
  grid.addEventListener("mousedown", onGridMouseDown);
  document.addEventListener("mousemove", onGridMouseMove);
  document.addEventListener("mouseup", onGridMouseUp);
  // 双重保险：双击任意带状态单元格也打开时长编辑器（防止角标太小点不中/缓存未生效时仍有入口）
  grid.addEventListener("dblclick", (ev) => {
    const td = ev.target.closest("td.cell");
    if (!td) return;
    const rec = getAtt(document.getElementById("attMonth").value || "2026-08", td.dataset.emp);
    const cur = (rec[td.dataset.day] && rec[td.dataset.day][td.dataset.shift]) || "";
    const curS = (typeof cur === "object") ? cur.s : cur;
    if (curS) openDurationEditor(td.dataset.emp, td.dataset.day, td.dataset.shift);
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
        const { s, min, color } = cellView(v);
        const bg = color ? ` style="background:${color.bg};color:${color.fg}"` : "";
        // 休息日（周末/节假日放假）且为空 → 显示灰色“休”占位，提示“这格不用填”；点击仍可改为出勤/加班等
        const isRest = !isWorkday(month, d);
        const isEmptyRest = !s && isRest && sh !== "ot";   // 加班行不加“休”（加班可选，空即无加班）
        // 时长角标：可带时长的状态都显示（整段请假 4h，加班 1h，迟到 30m）；休息占位格不显示
        const showMin = (!isEmptyRest && min != null) ? min : ((!isEmptyRest && isDurationStatus(s)) ? defaultMinFor(s) : null);
        const badge = showMin != null ? `<span class="dur" title="点此设置时长">${fmtMin(showMin)}</span>` : "";
        const cls = "cell" + (hol ? " cell-holiday" : "") + (isEmptyRest ? " cell-rest" : "");
        const content = isEmptyRest ? `<span class="rest-tag" title="休息日（无需填写，点击可改）">休</span>` : s + badge;
        body += `<td class="${cls}" data-emp="${e.id}" data-day="${d}" data-shift="${sh}" data-ei="${i}" data-di="${d}" data-si="${si}"${bg}>${content}</td>`;
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

// 单元格点击：点格子循环切换状态；点「时长」角标打开时长编辑（不切换状态）
function onCellClick(td, ev) {
  const empId = td.dataset.emp, day = td.dataset.day, shift = td.dataset.shift;
  const month = document.getElementById("attMonth").value || "2026-08";
  const emp = state.data.employees.find(x => x.id === empId);
  if (!emp) return;
  // 点「时长」角标 → 打开时长编辑，不切换状态
  if (ev && ev.target.closest(".dur")) { openDurationEditor(empId, day, shift); return; }

  const rec = { ...getAtt(month, empId) };
  const cell = { ...(rec[day] || { am: "", pm: "", ot: "" }) };
  const cur = cell[shift] || "";
  const curS = (typeof cur === "object") ? cur.s : cur;

  // 根据时段与日期类型决定可循环状态：
  //   - 加班行（ot）只能「加 / 空」切换；
  //   - 上午/下午行（am/pm）在普通工作日不能选「加」，循环 √→事→病→缺→调→年→空；
  //   - 上午/下午行在周末或节假日放假时允许「加」（来上班算加班），走完整循环（含迟/退/加）。
  const d = Number(day);
  const wd = weekdayOf(month, d);
  const hol = holidayOf(month, d);
  const isRestDay = (wd === 0 || wd === 6) || (hol && hol.type === "holiday");
  const isOt = shift === "ot";
  const st = state.data.settings || {};
  const enabledStatuses = st.enableLateEarly === false ? STATUSES.filter(s => s !== "迟" && s !== "退") : STATUSES;
  const cycle = isOt
    ? ["加", ""]
    : isRestDay
      ? [...enabledStatuses, ""]
      : ["√", "事", "病", "缺", "调", "年", ""];
  let idx = (cycle.indexOf(curS) + 1) % cycle.length;
  let next = cycle[idx];

  // 调休余额（动态计算）不足时跳过「调」，继续循环（不阻断）
  const half = st.halfDayMinutes || HALF_DAY_MINUTES;
  if (!isOt && next === "调" && st.enforceRestBalance !== false) {
    // 当前格子若已占「调」，先把这部分释放再判断可用
    const curMin = (typeof cur === "object" && cur.s === "调" && cur.min != null) ? cur.min : (curS === "调" ? half : 0);
    const avail = computeRestMinutes(empId) + curMin;
    if (avail < half) {
      showToast(emp.name + " 可调休余额不足（可用 " + (avail / 60).toFixed(1) + " 小时，需 " + (half / 60) + " 小时），已跳过「调休」");
      idx = (idx + 1) % cycle.length;
      next = cycle[idx];
    }
  }

  // 存储：加/迟/退 存为带时长的对象（默认 1h / 30m），其余状态存为纯字符串（整段=半天）
  if (next === "") cell[shift] = "";
  else if (next === "加" || next === "迟" || next === "退") cell[shift] = { s: next, min: defaultMinFor(next) };
  else cell[shift] = next;

  rec[day] = cell;
  saveAtt(month, empId, rec);
  window.__renderAll();
}

// ---------- 拖拽框选 + 批量应用 ----------
// 设计：在单元格上按下并拖动 → 高亮一个矩形区域；松手弹出工具条，点某状态即应用给区域内所有格。
//       加班行只接受“加/清除”；若只是单击（未拖动），保持原“循环切换”手感。
let selStart = null, selMoved = false, dragging = false;
function cellCoord(td) {
  return { ei: +td.dataset.ei, di: +td.dataset.di, si: +td.dataset.si, empId: td.dataset.emp, day: td.dataset.day, shift: td.dataset.shift };
}
function onGridMouseDown(ev) {
  // 点击「时长」角标：直接用 mousedown 打开编辑器（比 click 更稳，不会被后续逻辑吞掉）
  const dur = ev.target.closest(".dur");
  if (dur) {
    const td = dur.closest("td.cell");
    if (td) openDurationEditor(td.dataset.emp, td.dataset.day, td.dataset.shift);
    return;
  }
  const td = ev.target.closest("td.cell");
  if (!td) return;
  closeBulkBar();                 // 任何新的按下先关掉上一次工具条
  selStart = cellCoord(td);
  dragging = true; selMoved = false;
  ev.preventDefault();             // 避免拖拽时选中页面文字
}
function onGridMouseMove(ev) {
  if (!dragging || !selStart) return;
  const td = ev.target.closest("td.cell");
  if (!td) return;
  const c = cellCoord(td);
  if (c.ei === selStart.ei && c.di === selStart.di && c.si === selStart.si) return; // 还在起始格
  selMoved = true;
  highlightRange(c);
}
function onGridMouseUp(ev) {
  if (!dragging) return;
  dragging = false;
  const td = ev.target.closest("td.cell");
  if (selMoved && td) {
    showBulkBar(ev);              // 框选完成 → 弹工具条
  } else if (selStart && td) {
    const cell = ev.target.closest("td.cell");   // 未拖动：等同单击 → 循环切换（或点时长角标）
    if (cell) onCellClick(cell, ev);
  } else {
    document.querySelectorAll("#attGrid td.cell.sel").forEach(x => x.classList.remove("sel")); // 表格外松开：清高亮
  }
  selStart = null; selMoved = false;
}
function highlightRange(cur) {
  const minEi = Math.min(selStart.ei, cur.ei), maxEi = Math.max(selStart.ei, cur.ei);
  const minDi = Math.min(selStart.di, cur.di), maxDi = Math.max(selStart.di, cur.di);
  const minSi = Math.min(selStart.si, cur.si), maxSi = Math.max(selStart.si, cur.si);
  document.querySelectorAll("#attGrid td.cell").forEach(td => {
    const te = +td.dataset.ei, td_ = +td.dataset.di, ts = +td.dataset.si;
    const inRange = te >= minEi && te <= maxEi && td_ >= minDi && td_ <= maxDi && ts >= minSi && ts <= maxSi;
    td.classList.toggle("sel", inRange);
  });
}
function showBulkBar(ev) {
  const cells = [...document.querySelectorAll("#attGrid td.cell.sel")];
  if (!cells.length) return;
  closeBulkBar();
  const bar = document.createElement("div");
  bar.id = "bulkBar";
  bar.className = "att-bulk-bar";
  let items = [["√", "出勤"], ["事", "事假"], ["病", "病假"], ["缺", "缺勤"], ["调", "调休"], ["年", "年假"], ["加", "加班"], ["迟", "迟到"], ["退", "早退"], ["清除", "清除/重置"]];
  if (state.data.settings.enableLateEarly === false) items = items.filter(([s]) => s !== "迟" && s !== "退");
  bar.innerHTML = `<span class="ttl">批量（${cells.length} 格）</span>`
    + items.map(([s, t]) => `<button class="bk" data-s="${s}" title="${t}">${s === "清除" ? "✕" : s}</button>`).join("")
    + `<button class="bk close" data-close="1" title="关闭">×</button>`;
  document.body.appendChild(bar);
  const bw = 420, bh = 50;
  let x = ev.clientX, y = ev.clientY + 14;
  x = Math.max(8, Math.min(x, window.innerWidth - bw - 8));
  y = Math.max(8, Math.min(y, window.innerHeight - bh - 8));
  bar.style.left = x + "px"; bar.style.top = y + "px";
  bar.querySelectorAll(".bk[data-s]").forEach(b => b.onclick = () => applyBulk(cells, b.dataset.s));
  bar.querySelector("[data-close]").onclick = closeBulkBar;
  setTimeout(() => document.addEventListener("mousedown", outsideClose, true), 0);
}
function outsideClose(e) {
  const bar = document.getElementById("bulkBar");
  if (bar && !bar.contains(e.target)) closeBulkBar();
}
function closeBulkBar() {
  const bar = document.getElementById("bulkBar");
  if (bar) bar.remove();
  document.querySelectorAll("#attGrid td.cell.sel").forEach(td => td.classList.remove("sel"));
  document.removeEventListener("mousedown", outsideClose, true);
}
// 批量应用：按员工分组，每人一次 saveAtt；调休做余额校验（批量内不超额）
function applyBulk(cells, status) {
  const month = document.getElementById("attMonth").value || "2026-08";
  const byEmp = {};
  cells.forEach(td => {
    const c = cellCoord(td);
    (byEmp[c.empId] = byEmp[c.empId] || {})[c.day + "|" + c.shift] = { day: c.day, shift: c.shift };
  });
  let applied = 0, skipped = 0;
  for (const empId in byEmp) {
    const emp = state.data.employees.find(x => x.id === empId);
    if (!emp) continue;
    const rec = { ...getAtt(month, empId) };
    let avail = computeRestMinutes(empId);   // 当前可用余额（用于调休校验，批量内递减/递增）
    for (const key in byEmp[empId]) {
      const { day, shift } = byEmp[empId][key];
      const ok = setCellStatus(emp, rec, day, shift, status, avail);
      if (ok.applied) applied++; else skipped++;
      avail = ok.avail;
    }
    saveAtt(month, empId, rec);
  }
  closeBulkBar();
  window.__renderAll();
  if (skipped) showToast(`已应用 ${applied} 格，跳过 ${skipped} 格（所选状态不适用于这些单元格）`);
  else if (applied) showToast(`已批量应用 ${applied} 格`);
}
// 设置单个格状态；avail 为“进入本格前的可用余额”，返回更新后的可用余额（批量内联动）
function setCellStatus(emp, rec, day, shift, status, avail) {
  const st = state.data.settings || {};
  const half = st.halfDayMinutes || HALF_DAY_MINUTES;
  const ratio = st.overtimeToRestRatio ?? 1;
  const month = document.getElementById("attMonth").value || "2026-08";
  const d = Number(day);
  const isRestDay = !isWorkday(month, d);
  const isOt = shift === "ot";
  const blank = { am: "", pm: "", ot: "" };
  if (status === "清除") {
    const c = { ...(rec[day] || blank) };
    c[shift] = "";
    rec[day] = c;
    return { applied: true, avail };
  }
  if (isOt) {                                   // 加班行：只能 加 / 清除
    if (status !== "加") return { applied: false, avail };
    const min = defaultMinFor("加");
    if (st.overtimeToRest) avail += min * ratio;
    const c = { ...(rec[day] || blank) }; c[shift] = { s: "加", min }; rec[day] = c;
    return { applied: true, avail };
  }
  if (status === "加") {                         // 上午/下午加班：仅休息日允许
    if (!isRestDay) return { applied: false, avail };
    const min = defaultMinFor("加");
    if (st.overtimeToRest) avail += min * ratio;
    const c = { ...(rec[day] || blank) }; c[shift] = { s: "加", min }; rec[day] = c;
    return { applied: true, avail };
  }
  if (status === "调") {                         // 调休：做余额校验
    const cur = (rec[day] && rec[day][shift]) || "";
    const curMin = (typeof cur === "object" && cur.s === "调" && cur.min != null) ? cur.min : (cur === "调" ? half : 0);
    const newMin = (typeof cur === "object" && cur.s === "调" && cur.min != null) ? cur.min : half;
    const canUse = avail + curMin;              // 先把本格已占的调休释放
    if (st.enforceRestBalance !== false && canUse < newMin) return { applied: false, avail };
    avail = canUse - newMin;
    const c = { ...(rec[day] || blank) };
    c[shift] = (typeof cur === "object" && cur.s === "调") ? cur : "调";
    rec[day] = c;
    return { applied: true, avail };
  }
  // 其余状态（√ 事 病 缺 年 迟 退）：纯字符串或带时长对象
  const c = { ...(rec[day] || blank) };
  if (status === "迟" || status === "退") c[shift] = { s: status, min: defaultMinFor(status) };
  else c[shift] = status;
  rec[day] = c;
  return { applied: true, avail };
}

// 时长编辑弹窗（点单元格里的「时长」角标触发）：步进器设小时/分钟 + 快捷档
function openDurationEditor(empId, day, shift) {
  const month = document.getElementById("attMonth").value || "2026-08";
  const emp = state.data.employees.find(x => x.id === empId);
  if (!emp) return;
  const rec = getAtt(month, empId);
  const cell = rec[day] || {};
  const cur = cell[shift] || "";
  const curS = (typeof cur === "object") ? cur.s : cur;
  if (!curS) return;                       // 无状态不弹（角标只在有状态时出现）
  const label = STATUS_LABEL[curS] || curS;
  const total = (typeof cur === "object" && cur.min != null) ? cur.min : defaultMinFor(curS);
  let h = Math.floor(total / 60), m = total % 60;
  const st = state.data.settings || {};
  const ratio = st.overtimeToRestRatio ?? 1;
  const durationHint = curS === "调"
    ? (st.enforceRestBalance === false
      ? "将从「可调休」余额中扣除此时长；当前允许余额为负数。"
      : "将从「可调休」余额中扣除此时长；余额不足将阻止保存。")
    : curS === "加" && st.overtimeToRest
      ? `将按实际加班时长 × ${ratio} 计入「可调休」余额。`
      : curS === "加"
        ? "当前未开启「加班转调休」，该时长仅记录。"
        : "该时长仅记录，不影响可调休余额。";

  openModal(`
    <h3>设置时长 · ${label}</h3>
    <div class="field duration-stepper">
      <span style="width:44px;">小时</span>
      <button class="btn btn-sm" id="dHdec">−</button>
      <b id="dH" style="min-width:24px;text-align:center;">${h}</b>
      <button class="btn btn-sm" id="dHinc">+</button>
    </div>
    <div class="field duration-stepper">
      <span style="width:44px;">分钟</span>
      <button class="btn btn-sm" id="dMdec">−</button>
      <b id="dM" style="min-width:24px;text-align:center;">${m}</b>
      <button class="btn btn-sm" id="dMinc">+</button>
    </div>
    <div class="row" style="gap:6px;margin:12px 0;">
      <button class="btn btn-sm" data-chip="30">0.5h</button>
      <button class="btn btn-sm" data-chip="60">1h</button>
      <button class="btn btn-sm" data-chip="120">2h</button>
      <button class="btn btn-sm" data-chip="240">4h</button>
    </div>
    <div class="hint">${durationHint}</div>
    <div class="modal-actions">
      <button class="btn" id="dCancel">取消</button>
      <button class="btn btn-primary" id="dOk">确定</button>
    </div>`);

  const hEl = document.getElementById("dH"), mEl = document.getElementById("dM");
  const upd = () => { hEl.textContent = h; mEl.textContent = m; };
  const setH = v => { h = Math.max(0, Math.min(23, v)); upd(); };
  const setM = v => { m = Math.max(0, Math.min(59, v)); upd(); };
  document.getElementById("dHdec").onclick = () => setH(h - 1);
  document.getElementById("dHinc").onclick = () => setH(h + 1);
  document.getElementById("dMdec").onclick = () => setM(m - 1);
  document.getElementById("dMinc").onclick = () => setM(m + 1);
  document.querySelectorAll("[data-chip]").forEach(b => b.onclick = () => {
    const mm = +b.dataset.chip; setH(Math.floor(mm / 60)); setM(mm % 60);
  });
  document.getElementById("dCancel").onclick = closeModal;
  document.getElementById("dOk").onclick = () => {
    const min = h * 60 + m;
    if (curS === "调" && (state.data.settings || {}).enforceRestBalance !== false) {
      // 余额检查：把当前格子已占的「调」释放后再判断能否负担新时长
      const curMin = (typeof cur === "object" && cur.min != null) ? cur.min : defaultMinFor("调");
      const avail = computeRestMinutes(empId) + curMin;
      if (min > avail) {
        showToast(emp.name + " 可调休余额不足（可用 " + (avail / 60).toFixed(1) + " 小时），已取消");
        closeModal(); return;
      }
    }
    const r = { ...getAtt(month, empId) };
    const c = { ...(r[day] || { am: "", pm: "", ot: "" }) };
    c[shift] = { s: curS, min };
    r[day] = c;
    saveAtt(month, empId, r);
    closeModal();
    window.__renderAll();
  };
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
