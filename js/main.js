// ============================================================
// main.js — 程序入口（把所有模块组装起来）
// ------------------------------------------------------------
// 这里只做“初始化与调度”，不含具体业务逻辑：
//   1) 启动数据层（必要时注入示例）
//   2) 注册各模块的事件绑定（initXxx，只跑一次）
//   3) 绑定顶部栏（组织切换/导出/导入/清空）和 Tab 导航
//   4) 首次全量渲染
// 模块之间需要互相刷新时，统一调用 window.__renderAll()（见底部 renderAll）。
// ============================================================

import { ensureSeed, state, persist, emptyData, getOrgs, getCurrentOrgId, getCurrentOrg, setCurrentOrg, addOrg, migrateCurrent } from "./store.js";
import { buildSample } from "./sample.js";
import { openModal, closeModal, downloadFile, curMonth, curDay } from "./ui.js";
import { initRoster, renderRoster } from "./roster.js";
import { initAttendance, renderAttendance } from "./attendance.js";
import { initPayroll, renderPayroll } from "./payroll.js";
import { initDashboard, renderDashboard } from "./dashboard.js";

// ---------- 顶部：组织下拉框渲染 ----------
function renderOrgs() {
  const sel = document.getElementById("orgSelect");
  sel.innerHTML = "";
  getOrgs().forEach(o => {
    const op = document.createElement("option");
    op.value = o.id; op.textContent = o.name;
    sel.appendChild(op);
  });
  sel.value = getCurrentOrgId();
}

// ---------- 顶部：“今天要处理”置顶区 ----------
// 规则：本月之前未填的考勤算“逾期”（红色）；本月有考勤但无薪资算“待核算”。
function renderToday() {
  const box = document.getElementById("todoList");
  box.innerHTML = "";
  const month = curMonth();
  const today = curDay();
  const items = [];

  // 考勤逾期检查
  state.data.employees.forEach(e => {
    const a = state.data.attendance.find(x => x.month === month && x.empId === e.id);
    const rec = a ? a.rec : {};
    let missing = 0;
    for (let d = 1; d < today; d++) { if (!rec[d]) missing++; } // 今天之前的日期没填 → 缺失
    if (missing > 0) {
      items.push({ danger: true, text: `<b>${e.name}</b> ${month} 考勤待补录（逾期 ${missing} 天）`, tab: "attendance" });
    }
  });

  // 薪资待核算检查：本月一条薪资记录都没有
  const hasPay = state.data.payroll.some(p => p.month === month);
  if (!hasPay && state.data.employees.length) {
    items.push({ danger: false, text: `${month} 薪资待核算（${state.data.employees.length} 人）`, tab: "payroll" });
  }

  if (!items.length) { box.innerHTML = '<div class="empty">暂无待处理事项，一切正常。</div>'; return; }
  items.forEach(it => {
    const el = document.createElement("div");
    el.className = "todo" + (it.danger ? " danger" : "");
    el.innerHTML = `<span class="dot"></span><span class="txt">${it.text}</span>`;
    const b = document.createElement("button"); b.className = "go"; b.textContent = "去处理";
    b.addEventListener("click", () => switchTab(it.tab));
    el.appendChild(b);
    box.appendChild(el);
  });
}

// ---------- 切换 Tab ----------
function switchTab(name) {
  document.querySelectorAll("nav.tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".section").forEach(s => s.classList.toggle("active", s.id === name));
}

// ---------- 全量渲染（任一模块改动后都调用它） ----------
function renderAll() {
  renderOrgs();
  renderToday();
  renderRoster();
  renderAttendance();
  renderPayroll();
  renderDashboard();
}
// 挂到 window 上，让其它模块（roster/attendance/payroll）能直接调用，避免循环 import
window.__renderAll = renderAll;

// ---------- 绑定顶部栏：组织切换 / 新建组织 / 导出 / 导入 / 清空 ----------
function bindTopbar() {
  // 切换组织
  document.getElementById("orgSelect").addEventListener("change", (e) => {
    setCurrentOrg(e.target.value);
    renderAll();
  });

  // 新建组织（弹窗）
  document.getElementById("addOrgBtn").addEventListener("click", () => {
    openModal(`
      <h3>新建组织</h3>
      <div class="row"><div class="field" style="flex:1"><label>组织名称</label>
        <input id="newOrg" placeholder="如 某某科技有限公司"></div></div>
      <div class="modal-actions">
        <button class="btn" id="cancelOrgBtn">取消</button>
        <button class="btn btn-primary" id="createOrgBtn">创建</button>
      </div>`);
    document.getElementById("cancelOrgBtn").addEventListener("click", closeModal);
    document.getElementById("createOrgBtn").addEventListener("click", () => {
      const name = document.getElementById("newOrg").value.trim();
      if (!name) { alert("请输入组织名称"); return; }
      addOrg(name);
      closeModal();
      renderAll();
    });
  });

  // 导出 JSON 备份
  document.getElementById("exportBtn").addEventListener("click", () => {
    const payload = { org: getCurrentOrg(), data: state.data };
    const d = new Date().toISOString().slice(0, 10);
    downloadFile(JSON.stringify(payload, null, 2), "hr-workbench_" + getCurrentOrgId() + "_" + d + ".json", "application/json");
  });

  // 导入恢复（选择文件后读取并覆盖当前组织）
  document.getElementById("importBtn").addEventListener("click", () => document.getElementById("importFile").click());
  document.getElementById("importFile").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result);
        if (!confirm("导入将覆盖当前组织（" + getCurrentOrgId() + "）的全部数据，确认继续？")) return;
        if (obj.data) { state.data = obj.data; persist(); }
        migrateCurrent();   // 导入的旧数据也升级到新结构（补 restMinutes 等字段）
        renderAll();
        alert("导入成功");
      } catch (err) { alert("文件解析失败：" + err.message); }
    };
    reader.readAsText(f);
    e.target.value = "";   // 清空，保证同一文件可重复选择
  });

  // 清空示例数据（二次确认，防误删）
  document.getElementById("clearBtn").addEventListener("click", () => {
    if (!confirm("确认清空当前组织全部数据（员工/考勤/薪资）？此操作不可撤销。")) return;
    state.data = emptyData();
    persist();
    renderAll();
    alert("已清空示例数据，可重新录入。");
  });
}

// ---------- 绑定 Tab 导航 ----------
function bindTabs() {
  document.querySelectorAll("nav.tabs button").forEach(b => {
    b.addEventListener("click", () => switchTab(b.dataset.tab));
  });
}

// ============================================================
// 启动！
// ============================================================
ensureSeed(buildSample);   // 1) 数据层启动（首次注入示例）
window.__renderAll = renderAll; // 2) 注册全局刷新函数（必须在各 init 之前）
initRoster();              // 3) 各模块事件绑定（一次）
initAttendance();
initPayroll();
initDashboard();
bindTopbar();              // 4) 顶部栏与 Tab 绑定
document.getElementById("modalMask").addEventListener("click", (e) => { if (e.target === e.currentTarget) closeModal(); });
bindTabs();
renderAll();               // 5) 首次绘制全部内容
