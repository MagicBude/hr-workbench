/*
 * dashboard.js — 月度人事看板
 *
 * 输入：员工任职区间、考勤记录、节假日设置和薪资记录。
 * 输出：KPI、出勤率环形图和实发工资趋势图。
 * 协作：domain.js 提供统一出勤口径，store.js 提供当前组织数据，ui.js 格式化金额。
 *
 * 图表使用内联 SVG，以保持零运行时依赖和离线能力。看板不得自行发明业务口径，
 * 否则会与考勤表和导出结果产生无法解释的差异。
 */

import { state, computeRestMinutes } from "./store.js";
import { fmtMoney } from "./ui.js";
import { attendanceMetrics, isEmployeeActiveInMonth } from "./domain.js";

// #region 初始化与指标汇总

export function initDashboard() {
  document.getElementById("dashMonth").addEventListener("change", renderDashboard);
}

// 余额由 store.js 根据初始值和全部考勤动态计算；通过参数传入读取函数，既避免
// 看板复制口径，也让“正数、零、负数”边界可以在无 DOM 环境中单独测试。
export function countOverdrawnEmployees(employees, getBalance) {
  return employees.reduce((count, employee) => count + (getBalance(employee.id) < 0 ? 1 : 0), 0);
}

export function renderDashboard() {
  const month = document.getElementById("dashMonth").value || "2026-08";
  const asOf = new Date().toLocaleDateString("sv-SE");
  const emps = state.data.employees.filter(e => isEmployeeActiveInMonth(e, month));

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
  const overdrawnCount = countOverdrawnEmployees(emps, computeRestMinutes);

  // —— KPI 卡片 ——
  document.getElementById("kpi").innerHTML = `
    <div class="box kpi-secondary"><div class="v">${emps.length}</div><div class="l">在职员工</div></div>
    <div class="box kpi-primary"><div class="v">${rate}%</div><div class="l">本月出勤率</div><span class="kpi-note">实际出勤 / 应出勤</span></div>
    <div class="box kpi-secondary"><div class="v">${fmtMoney(grossSum)}</div><div class="l">本月应发合计</div></div>
    <div class="box kpi-primary kpi-net"><div class="v">${fmtMoney(netSum)}</div><div class="l">本月实发合计</div><span class="kpi-note">员工实际到手金额</span></div>
    <button class="box kpi-alert ${overdrawnCount ? "active" : ""}" id="overdrawnKpi" type="button" ${overdrawnCount ? "" : "disabled"}>
      <span class="v">${overdrawnCount}</span><span class="l">调休透支人数</span>
      <span class="kpi-action">${overdrawnCount ? "查看花名册 →" : "暂无异常"}</span>
    </button>`;

  // 透支卡是异常入口而非静态数字。复用主导航按钮触发切页，避免看板反向依赖 main.js。
  document.getElementById("overdrawnKpi").addEventListener("click", () => {
    document.querySelector('nav.tabs button[data-tab="roster"]')?.click();
  });

  renderDonut(actual, expected, leave, absent, missing);
  renderTrend();
}

// #endregion 初始化与指标汇总

// #region SVG 图表

// 环形图：用一个完整的灰圈 + 一段绿色弧（stroke-dasharray 控制长度）表示占比
function renderDonut(actual, total, leave, absent, missing) {
  const el = document.getElementById("donut");
  if (total === 0) { el.innerHTML = '<div class="empty-state empty-state-compact"><span class="empty-state-icon">○</span><div><b>暂无考勤统计</b><p>录入本月考勤后显示出勤率。</p></div></div>'; return; }

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
    el.innerHTML = '<div class="empty-state empty-state-compact"><span class="empty-state-icon">↗</span><div><b>暂无薪资趋势</b><p>生成至少一个月的薪资后显示走势。</p></div></div>';
    legend.innerHTML = "";
    return;
  }

  const vals = months.map(m => state.data.payroll.filter(p => p.month === m).reduce((s, p) => s + p.net, 0));
  // SVG 的坐标宽度跟随容器，而不是把固定 560px 画布等比缩进超宽卡片。
  // 这样折线能利用横向空间，同时日期和金额仍保持可读字号。
  // Tab 切换时看板可能尚处于 display:none，clientWidth 会暂时为 0；因此桌面端改按
  // 视口宽度预估图表可用空间，移动端仍保留 560 的紧凑坐标系。
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth || 560;
  const W = viewportWidth > 768 ? Math.max(720, Math.min(1200, viewportWidth - 420)) : 560;
  const H = 180;
  const padX = 48;
  const padY = 30;
  const max = Math.max(...vals), min = Math.min(...vals, 0);
  const span = Math.max(1, max - min);

  // 把数据值映射到画布坐标：x 均匀分布，y 按数值高低换算
  const x = i => padX + i * (W - 2 * padX) / (months.length - 1 || 1);
  const y = v => H - padY - (v - min) / span * (H - 2 * padY);

  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const dots = vals.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" fill="#185FA5"/>`).join("");
  const labels = months.map((m, i) => `<text x="${x(i).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="#6b7280">${m.slice(2)}</text>`).join("");
  const yLabel = `<text x="6" y="${padY}" font-size="11" fill="#6b7280">${fmtMoney(max)}</text>`;

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%">
    <line x1="${padX}" y1="${H - padY}" x2="${W - padX}" y2="${H - padY}" stroke="#e5e7eb"/>
    <line x1="${padX}" y1="${padY}" x2="${padX}" y2="${H - padY}" stroke="#e5e7eb"/>
    <polyline points="${pts}" fill="none" stroke="#185FA5" stroke-width="2"/>${dots}${labels}${yLabel}
  </svg>`;
  legend.innerHTML = `<span><i style="background:#185FA5"></i>实发工资总额（¥）</span>`;
}

// #endregion SVG 图表
