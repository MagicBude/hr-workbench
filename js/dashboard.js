// ============================================================
// dashboard.js — 月度看板模块
// ------------------------------------------------------------
// 负责：把考勤/薪资数据汇总成“一眼看懂”的图表。
//  - KPI 卡片：在职人数、出勤率、应发/实发合计
//  - 出勤率环形图（内联 SVG，不依赖任何图表库）
//  - 工资趋势折线图（内联 SVG，按月）
// 说明：图表用原生 SVG 手画，保证零依赖、离线可用。
// ============================================================

import { state } from "./store.js";
import { fmtMoney } from "./ui.js";
import { attendanceMetrics, isEmployeeActiveOn } from "./domain.js";

export function initDashboard() {
  document.getElementById("dashMonth").addEventListener("change", renderDashboard);
}

export function renderDashboard() {
  const month = document.getElementById("dashMonth").value || "2026-08";
  const asOf = new Date().toLocaleDateString("sv-SE");
  const monthEnd = `${month}-${String(new Date(+month.slice(0, 4), +month.slice(5, 7), 0).getDate()).padStart(2, "0")}`;
  const emps = state.data.employees.filter(e => isEmployeeActiveOn(e, `${month}-01`) || isEmployeeActiveOn(e, monthEnd));

  // —— 出勤统计：累加当月所有员工的出勤天数与事病缺天数 ——
  let actual = 0, expected = 0, leave = 0, absent = 0, missing = 0;
  emps.forEach(emp => {
    const att = state.data.attendance.find(a => a.month === month && a.empId === emp.id);
    const m = attendanceMetrics(emp, month, att, state.data.holidays, state.data.settings.halfDayMinutes, asOf);
    actual += m.actualMinutes; expected += m.expectedMinutes; leave += m.leaveMinutes;
    absent += m.absentMinutes; missing += m.missingMinutes;
  });
  const rate = expected ? Math.round(actual / expected * 100) : 0;

  // —— 工资统计 ——
  const payRecs = state.data.payroll.filter(p => p.month === month);
  const grossSum = payRecs.reduce((s, p) => s + p.gross, 0);
  const netSum = payRecs.reduce((s, p) => s + p.net, 0);

  // —— KPI 卡片 ——
  document.getElementById("kpi").innerHTML = `
    <div class="box"><div class="v">${emps.length}</div><div class="l">在职员工</div></div>
    <div class="box"><div class="v">${rate}%</div><div class="l">本月出勤率</div></div>
    <div class="box"><div class="v">${fmtMoney(grossSum)}</div><div class="l">本月应发合计</div></div>
    <div class="box"><div class="v" style="color:var(--ok)">${fmtMoney(netSum)}</div><div class="l">本月实发合计</div></div>`;

  renderDonut(actual, expected, leave, absent, missing);
  renderTrend();
}

// 环形图：用一个完整的灰圈 + 一段绿色弧（stroke-dasharray 控制长度）表示占比
function renderDonut(actual, total, leave, absent, missing) {
  const el = document.getElementById("donut");
  if (total === 0) { el.innerHTML = '<div class="empty">本月暂无考勤数据</div>'; return; }

  const r = 70, cx = 150, cy = 80, circumference = 2 * Math.PI * r;
  const ratio = actual / total;
  const offset = circumference * (1 - ratio);   // 绿色弧的“缺失长度”= 剩余比例

  el.innerHTML = `<svg viewBox="0 0 300 160" width="100%">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e5e7eb" stroke-width="20"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#1d9e75" stroke-width="20"
      stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" transform="rotate(-90 ${cx} ${cy})"/>
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="26" font-weight="500" fill="#1f2329">${Math.round(ratio * 100)}%</text>
    <text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="12" fill="#6b7280">出勤占比</text>
  </svg>
  <div class="legend">
    <span><i style="background:#1d9e75"></i>实际 ${(actual / 60).toFixed(1)} 小时</span>
    <span><i style="background:#e5e7eb"></i>应出勤 ${(total / 60).toFixed(1)} 小时</span>
    <span>请假 ${(leave / 60).toFixed(1)}h · 缺勤 ${(absent / 60).toFixed(1)}h · 未录 ${(missing / 60).toFixed(1)}h</span>
  </div>`;
}

// 折线图：把每个月“实发总额”连成一条线
function renderTrend() {
  const el = document.getElementById("trend");
  const legend = document.getElementById("trendLegend");
  const months = [...new Set(state.data.payroll.map(p => p.month))].sort(); // 去重并排序

  if (months.length === 0) {
    el.innerHTML = '<div class="empty">暂无薪资数据，生成薪资后可见趋势</div>';
    legend.innerHTML = "";
    return;
  }

  const vals = months.map(m => state.data.payroll.filter(p => p.month === m).reduce((s, p) => s + p.net, 0));
  const W = 560, H = 200, pad = 34;
  const max = Math.max(...vals), min = Math.min(...vals, 0);
  const span = Math.max(1, max - min);

  // 把数据值映射到画布坐标：x 均匀分布，y 按数值高低换算
  const x = i => pad + i * (W - 2 * pad) / (months.length - 1 || 1);
  const y = v => H - pad - (v - min) / span * (H - 2 * pad);

  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const dots = vals.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" fill="#185FA5"/>`).join("");
  const labels = months.map((m, i) => `<text x="${x(i).toFixed(1)}" y="${H - 12}" text-anchor="middle" font-size="11" fill="#6b7280">${m.slice(2)}</text>`).join("");
  const yLabel = `<text x="6" y="${pad}" font-size="10" fill="#9aa0a6">${fmtMoney(max)}</text>`;

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%">
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#e5e7eb"/>
    <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${H - pad}" stroke="#e5e7eb"/>
    <polyline points="${pts}" fill="none" stroke="#185FA5" stroke-width="2"/>${dots}${labels}${yLabel}
  </svg>`;
  legend.innerHTML = `<span><i style="background:#185FA5"></i>实发工资总额（¥）</span>`;
}
