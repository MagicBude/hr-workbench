// ============================================================
// attendance.js — 考勤记录模块
// ------------------------------------------------------------
// 负责：按“月份 × 员工 × 日期”登记考勤状态。
// 交互：点击某个日期格，就在 7 种状态之间循环切换（出勤→事假→…→加班→出勤）。
// 每个员工一行右侧显示本月各状态汇总天数。
// ============================================================

import { state, persist } from "./store.js";
import { STATUSES, STATUS_COLOR } from "./config.js";
import { sumRec } from "./sample.js";

// 取某员工某月的考勤记录（{1:"√",2:"事",...}），没有则返回空对象
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

export function initAttendance() {
  // 切换月份时重新绘制网格
  document.getElementById("attMonth").addEventListener("change", renderAttendance);
}

export function renderAttendance() {
  const month = document.getElementById("attMonth").value || "2026-08";
  const grid = document.getElementById("attGrid");
  grid.innerHTML = "";

  // 第一行表头：员工 | 1..31 | 汇总
  const headNames = ["员工"];
  for (let d = 1; d <= 31; d++) headNames.push(d);
  headNames.push("汇总");
  headNames.forEach((h, i) => {
    const d = document.createElement("div");
    d.className = "att-head" + (i === 0 ? " att-name" : "") + (i === headNames.length - 1 ? " att-sum" : "");
    d.textContent = h;
    grid.appendChild(d);
  });

  if (!state.data.employees.length) {
    const d = document.createElement("div");
    d.className = "att-name"; d.style.gridColumn = "1 / -1";
    d.textContent = "请先在花名册添加员工";
    grid.appendChild(d);
    return;
  }

  // 每个员工一行
  state.data.employees.forEach(e => {
    const a = state.data.attendance.find(x => x.month === month && x.empId === e.id);
    const rec = a ? a.rec : {};
    const name = document.createElement("div"); name.className = "att-name"; name.textContent = e.name;
    grid.appendChild(name);

    // 31 个日期格
    for (let d = 1; d <= 31; d++) {
      const c = document.createElement("div"); c.className = "cell";
      const v = rec[d] || "";
      if (v) { c.textContent = v; c.style.background = STATUS_COLOR[v].bg; c.style.color = STATUS_COLOR[v].fg; }
      // 点击循环切换状态
      c.addEventListener("click", () => {
        const cur = getAtt(month, e.id);
        let idx = STATUSES.indexOf(cur[d] || "");
        idx = (idx + 1) % STATUSES.length;     // 取下一个状态，到末尾回到第一个
        const rec2 = { ...cur };                // 复制一份再改，避免直接改原对象
        rec2[d] = STATUSES[idx];
        saveAtt(month, e.id, rec2);
        window.__renderAll();                   // 刷新所有模块（网格/今天要处理/看板）
      });
      grid.appendChild(c);
    }

    // 本行汇总
    const sum = a ? a.summary : sumRec(rec);
    const s = document.createElement("div"); s.className = "att-sum";
    s.textContent = `出${sum.出勤} 事${sum.事假} 病${sum.病假} 缺${sum.缺勤} 调${sum.调休} 年${sum.年假} 加${sum.加班}`;
    grid.appendChild(s);
  });
}
