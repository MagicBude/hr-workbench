// ============================================================
// main.js — 应用入口与视图调度
// ------------------------------------------------------------
// 这里只做“初始化与调度”，不含具体业务逻辑：
//   1) 启动数据层（必要时注入示例）
//   2) 注册各模块的事件绑定（initXxx，只跑一次）
//   3) 绑定顶部栏（组织切换/导出/导入/清空）和 Tab 导航
//   4) 首次全量渲染
// 业务模块通过 ui.requestRefresh 声明受影响视图；全量刷新仅用于组织切换和整包数据替换。
// ============================================================

import { ensureSeed, state, persist, emptyData, getOrgs, getCurrentOrgId, getCurrentOrg, setCurrentOrg, addOrg, createSnapshot, createSnapshotForOrg, prepareImportedData, selectImportedOrg } from "./store.js";
import { buildSample } from "./sample.js";
import { openModal, closeModal, downloadFile, curMonth, curDay, showHelp, showToast } from "./ui.js";
import { initRoster, renderRoster, resetEmpColWidths } from "./roster.js";
import { initAttendance, renderAttendance, resetAttColWidths, isWorkday } from "./attendance.js";
import { initPayroll, renderPayroll } from "./payroll.js";
import { initDashboard, renderDashboard } from "./dashboard.js";
import { exportRosterXlsx, exportAttendanceXlsx, exportPayrollXlsx } from "./export.js";
import { initSettings, applyOrgSettings } from "./settings.js";
import { escapeHtml, isEmployeeActiveOn, IMPORT_LIMITS } from "./domain.js";
import { StorageError, storageErrorMessage } from "./storage.js";

// #region 全局存储错误反馈

// 普通点击中的存储异常会冒泡到 window。统一提示后阻止浏览器重复打印未处理异常；
// 不展示存储键、原始数据或异常堆栈，避免诊断信息泄露 HR 内容。
window.addEventListener("error", event => {
  if (!(event.error instanceof StorageError)) return;
  event.preventDefault();
  renderAll();
  showToast(storageErrorMessage(event.error.kind));
});

function showStartupError(error) {
  const message = error instanceof StorageError
    ? storageErrorMessage(error.kind)
    : "应用初始化失败，请刷新页面后重试。";
  const panel = document.createElement("div");
  panel.className = "card";
  panel.style.margin = "40px auto";
  panel.style.maxWidth = "640px";

  const title = document.createElement("h2");
  title.textContent = "HR Workbench 无法安全启动";
  const detail = document.createElement("p");
  detail.textContent = message;
  panel.append(title, detail);
  document.body.replaceChildren(panel);
}

// #endregion 全局存储错误反馈

// #region 组织与顶部待办渲染
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
  state.data.employees.filter(e => isEmployeeActiveOn(e, `${month}-${String(today).padStart(2, "0")}`)).forEach(e => {
    const a = state.data.attendance.find(x => x.month === month && x.empId === e.id);
    const rec = a ? a.rec : {};
    let missing = 0;
    for (let d = 1; d < today; d++) {
      if (!isWorkday(month, d)) continue;   // 周末 / 节假日放假 不算逾期（已在考勤表标“休”）
      const c = rec[d];
      // 兼容新旧结构：新结构某天只要有任一时段非空即算“已填”
      const filled = c && typeof c === "object" ? !!(c.am || c.pm || c.ot) : !!c;
      if (!filled) missing++;
    }
    if (missing > 0) {
      items.push({ danger: true, text: `<b>${escapeHtml(e.name)}</b> ${month} 考勤待补录（逾期 ${missing} 天）`, tab: "attendance" });
    }
  });

  // 薪资待核算检查：本月一条薪资记录都没有
  const activeEmployees = state.data.employees.filter(e => isEmployeeActiveOn(e, `${month}-${String(today).padStart(2, "0")}`));
  const pendingPay = activeEmployees.filter(e => {
    const pay = state.data.payroll.find(p => p.month === month && p.empId === e.id);
    return !pay || (pay.status || "draft") === "draft";
  }).length;
  if (pendingPay) {
    items.push({ danger: false, text: `${month} 薪资待核算或确认（${pendingPay} 人）`, tab: "payroll" });
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

// #endregion 组织与顶部待办渲染

// #region 视图调度

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
// 暴露轻量调度入口，供 ui.requestRefresh 在不产生循环 import 的前提下调用。
window.__renderAll = renderAll;
window.__refresh = (...modules) => {
  const refreshers = { orgs: renderOrgs, today: renderToday, roster: renderRoster, attendance: renderAttendance, payroll: renderPayroll, dashboard: renderDashboard };
  [...new Set(modules)].forEach(name => refreshers[name]?.());
};

// #endregion 视图调度

// #region 全局事件绑定

// ---------- 绑定顶部栏：组织切换 / 新建组织 / 导出 / 导入 / 清空 ----------
function bindTopbar() {
  // 切换组织
  document.getElementById("orgSelect").addEventListener("change", (e) => {
    setCurrentOrg(e.target.value);
    applyOrgSettings(true);
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
      applyOrgSettings(true);
      renderAll();
    });
  });

  // 导出 JSON 备份
  document.getElementById("exportBtn").addEventListener("click", () => {
    const payload = { org: getCurrentOrg(), data: state.data };
    const d = new Date().toISOString().slice(0, 10);
    downloadFile(JSON.stringify(payload, null, 2), "hr-workbench_" + getCurrentOrgId() + "_" + d + ".json", "application/json");
  });

  // 导入恢复（选择文件后读取并覆盖目标组织）
  document.getElementById("importBtn").addEventListener("click", () => document.getElementById("importFile").click());
  document.getElementById("importFile").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > IMPORT_LIMITS.fileBytes) {
      alert(`导入失败：文件不能超过 ${IMPORT_LIMITS.fileBytes / 1024 / 1024} MB`);
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result);
        if (typeof obj !== "object" || !obj || !obj.data) throw new Error("文件格式不对：缺少 data 字段");
        // 必须在确认、快照、创建组织或切换组织之前完成全部校验和迁移；
        // 任意校验失败都不能改变现有组织列表、当前组织或运行中数据。
        const preparedData = prepareImportedData(obj);
        // 备份文件自带组织信息（org.id）→ 自动创建/切换到该组织，让数据正确归属，
        // 避免误覆盖当前正在用的组织；没有 org 信息时则覆盖当前组织（兼容旧备份）。
        let org = null, targetName = "";
        if (obj.org && obj.org.id) {
          org = state.orgs.find(o => o.id === obj.org.id) || { id: obj.org.id, name: obj.org.name || obj.org.id };
          targetName = org.name;
        }
        if (!confirm("导入将覆盖组织「" + (targetName || getCurrentOrgId()) + "」的全部数据，确认继续？")) return;
        createSnapshotForOrg(org?.id || state.current, "导入数据前自动备份");
        if (org) {
          selectImportedOrg(org);
        }
        state.data = preparedData;
        persist();          // 校验、迁移后写入目标组织的数据键
        applyOrgSettings(true);
        renderAll();        // 含刷新组织下拉
        showToast("导入成功" + (targetName ? "，当前组织：" + targetName : ""));
      } catch (err) { alert("导入失败：" + err.message); }
    };
    reader.onerror = () => alert("导入失败：无法读取所选文件");
    reader.readAsText(f);
    e.target.value = "";   // 清空，保证同一文件可重复选择
  });

  // 清空示例数据（二次确认，防误删）
  document.getElementById("clearBtn").addEventListener("click", () => {
    if (!confirm("确认清空当前组织全部数据（员工/考勤/薪资）？清空前会自动创建可恢复快照。")) return;
    createSnapshot("清空组织数据前自动备份");
    state.data = emptyData();
    persist();
    applyOrgSettings(true);
    renderAll();
    showToast("已清空当前组织，可从数据安全页恢复快照");
  });
}

// ---------- 绑定 Tab 导航 ----------
function bindTabs() {
  document.querySelectorAll("nav.tabs button").forEach(b => {
    b.addEventListener("click", () => switchTab(b.dataset.tab));
  });
}

// ---------- 绑定各模块"导出 Excel"按钮 ----------
function bindExport() {
  document.getElementById("expRosterBtn").addEventListener("click", exportRosterXlsx);
  document.getElementById("expAttBtn").addEventListener("click", () => exportAttendanceXlsx(document.getElementById("attMonth").value || "2026-08"));
  document.getElementById("expPayBtn").addEventListener("click", () => exportPayrollXlsx(document.getElementById("payMonth").value || "2026-08"));
}

// ---------- 绑定"恢复默认列宽"按钮 ----------
function bindResetColWidths() {
  document.getElementById("resetEmpColBtn").addEventListener("click", resetEmpColWidths);
  document.getElementById("resetAttColBtn").addEventListener("click", resetAttColWidths);
}

// ---------- 弹窗键盘操作：Esc 关闭 / Enter 保存 ----------
function bindGlobalKeys() {
  document.addEventListener("keydown", (e) => {
    const mask = document.getElementById("modalMask");
    if (!mask.classList.contains("show")) return;          // 弹窗没开就不处理
    if (e.key === "Escape") closeModal();
    else if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") {
      const btn = document.querySelector("#modal .btn-primary");
      if (btn) { e.preventDefault(); btn.click(); }         // Enter 触发"主按钮"
    }
  });
}

// #endregion 全局事件绑定

// #region 帮助内容

// ---------- 帮助按钮（规则说明弹窗） ----------
function bindHelp() {
  document.getElementById("helpAttBtn").addEventListener("click", () => showHelp("考勤规则说明", [
    "每天分 <b>上午 / 下午 / 加班</b> 三个时段：普通工作日上午/下午不含加班状态，休息日可选择完整状态；加班行只在<b>加 / 空</b>之间切换",
    "带时长的状态（调/年/事/病/缺/加/迟/退）格子里有蓝色「时长」角标，点它设 <b>小时/分钟</b>：加班默认 1 小时，迟到/早退默认 30 分钟，请假整段默认 4 小时",
    "选 <b>调</b> 从可调休余额扣对应分钟（余额=初始+加班累计−调休累计，动态计算，精确到分钟）；开启余额校验时，不足会提示并跳过",
    "选 <b>加</b> 且开启「加班转调休」时，按实际加班分钟×比例 增加可调休余额",
    "<b>迟/退</b> 为迟到/早退，带分钟，不影响可调休余额",
    "节假日：<b>红=放假</b>（不计出勤）、<b>蓝=调休上班</b>，可在「节假日设置」调整",
    "汇总：上/下午各算 0.5 天，加班按次计，迟到/早退按半天计"
  ]));
  document.getElementById("helpPayBtn").addEventListener("click", () => showHelp("薪资计算说明", [
    "五险一金 = <b>社保基数 × 比例</b>（基数默认=基本月薪，可在员工编辑里单独设置）",
    "比例在「薪资参数设置」里改，分<b>公司缴纳</b>与<b>个人缴纳</b>两部分",
    "本月应发 = 基本月薪 + 出差补贴 + 奖金 + 加班费",
    "个税 = max(0, 应发 − 个人缴纳合计 − 5000) × 10%（演示简化，非真实累进税率）",
    "实发 = 应发 − 个人缴纳合计 − 个税"
  ]));
}

// #endregion 帮助内容

// #region 启动顺序

// ============================================================
// 启动！
// ============================================================
try {
  ensureSeed(buildSample);   // 1) 数据层启动（首次注入示例）
  initRoster();              // 3) 各模块事件绑定（一次）
  initAttendance();
  initPayroll();
  initDashboard();
  initSettings();
  bindTopbar();              // 4) 顶部栏与 Tab 绑定
  document.getElementById("modalMask").addEventListener("click", (e) => { if (e.target === e.currentTarget) closeModal(); });
  bindTabs();
  bindExport();              // 4.5) 各模块"导出 Excel"按钮
  bindResetColWidths();      // 4.55) 恢复默认列宽按钮
  bindGlobalKeys();          // 4.6) 弹窗 Esc 关闭 / Enter 保存
  bindHelp();                // 4.7) 帮助按钮（规则说明）
  applyOrgSettings(true);    // 4.8) 应用当前组织的界面偏好与默认月份
  renderAll();               // 5) 首次绘制全部内容
} catch (error) {
  showStartupError(error);
}

// #endregion 启动顺序
