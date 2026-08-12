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

import { ensureSeed, state, persist, emptyData, getOrgs, getCurrentOrgId, getCurrentOrg, setCurrentOrg, addOrg, createSnapshot, createSnapshotForOrg, prepareImportedData, importPreparedData, hasAcknowledgedLocalPrivacy, acknowledgeLocalPrivacy } from "./store.js";
import { buildSample } from "./sample.js";
import { openModal, closeModal, downloadFile, curMonth, curDay, showHelp, showToast, requestConfirm } from "./ui.js";
import { initRoster, renderRoster, resetEmpColWidths } from "./roster.js";
import { initAttendance, renderAttendance, resetAttColWidths } from "./attendance.js";
import { initPayroll, renderPayroll } from "./payroll.js";
import { initDashboard, renderDashboard } from "./dashboard.js";
import { exportRosterXlsx, exportAttendanceXlsx, exportPayrollXlsx, exportCombinedXlsx, monthRange } from "./export.js";
import { initSettings, applyOrgSettings } from "./settings.js";
import { attendanceMetrics, escapeHtml, isEmployeeActiveInMonth, isEmployeeActiveOn, IMPORT_LIMITS } from "./domain.js";
import { StorageError, storageErrorMessage } from "./storage.js";
import { HALF_DAY_MINUTES } from "./config.js";
import { reportError } from "./diagnostics.js";

// #region 全局存储错误反馈

// 普通点击中的存储异常会冒泡到 window。统一提示后阻止浏览器重复打印未处理异常；
// 不展示存储键、原始数据或异常堆栈，避免诊断信息泄露 HR 内容。
window.addEventListener("error", event => {
  reportError(event.error, { module: "window", operation: "error" });
  if (event.error instanceof StorageError) {
    event.preventDefault();
    renderAll();
    showToast(storageErrorMessage(event.error.kind));
  }
});
window.addEventListener("unhandledrejection", event => {
  reportError(event.reason, { module: "window", operation: "unhandledrejection" });
});

function showStartupError(error) {
  reportError(error, { module: "main", operation: "startup" });
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

  // 待办只统计今天之前的应出勤时段。复用领域层的任职、节假日和半天口径，
  // 避免“只填上午”或“只填加班”被页面误判为整天已完成。
  if (today > 1) {
    const cutoff = `${month}-${String(today - 1).padStart(2, "0")}`;
    const halfDayMinutes = state.data.settings.halfDayMinutes || HALF_DAY_MINUTES;
    state.data.employees.filter(employee => isEmployeeActiveInMonth(employee, month)).forEach(employee => {
      const attendance = state.data.attendance.find(item => item.month === month && item.empId === employee.id);
      const metrics = attendanceMetrics(employee, month, attendance, state.data.holidays, halfDayMinutes, cutoff);
      const missingShifts = metrics.missingMinutes / halfDayMinutes;
      if (missingShifts > 0) {
        items.push({
          danger: true,
          text: `<b>${escapeHtml(employee.name)}</b> ${month} 考勤待补录（缺 ${missingShifts} 个时段）`,
          tab: "attendance"
        });
      }
    });
  }

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

// 隐私遮罩是“离开座位时临时挡住页面”的本机会话功能，不是身份认证。
// 启用时给页面其他顶层节点加 inert，避免键盘焦点或读屏继续访问遮罩后的敏感内容。
function setPrivacyShield(active) {
  const shield = document.getElementById("privacyShield");
  document.querySelectorAll("body > :not(#privacyShield)").forEach(element => { element.inert = active; });
  shield.hidden = !active;
  if (active) document.getElementById("privacyResumeBtn").focus();
  else document.getElementById("privacyBtn").focus();
}

function bindPrivacyControls() {
  const privacyButton = document.getElementById("privacyBtn");
  const resumeButton = document.getElementById("privacyResumeBtn");
  // 静态站点更新时，浏览器可能短暂组合旧 HTML 与新 JS。缺少新节点时跳过该增强，
  // 让主应用仍能启动；下一次刷新拿到同版本资源后遮罩功能会自然恢复。
  if (!privacyButton || !resumeButton) return;
  privacyButton.addEventListener("click", () => {
    closeModal();
    setPrivacyShield(true);
  });
  resumeButton.addEventListener("click", () => setPrivacyShield(false));
}

function showFirstUsePrivacyNotice() {
  if (hasAcknowledgedLocalPrivacy()) return;
  openModal(`
    <h3>使用真实人事数据前请确认</h3>
    <p>这是单设备本地工具，数据以明文保存在当前浏览器中，没有账号、权限控制或企业级加密。</p>
    <p>请勿在共享电脑、公共终端或不受信任的浏览器中录入真实员工和薪资数据。</p>
    <div class="modal-actions"><button class="btn btn-primary" id="privacyAckBtn">我已了解</button></div>`);
  document.getElementById("privacyAckBtn").addEventListener("click", () => {
    acknowledgeLocalPrivacy();
    closeModal();
  });
}

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
    reader.onload = async () => {
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
        if (!await requestConfirm({ title: "覆盖组织数据", message: "导入将覆盖组织「" + (targetName || getCurrentOrgId()) + "」的全部数据。", confirmText: "覆盖并导入", danger: true })) return;
        createSnapshotForOrg(org?.id || state.current, "导入数据前自动备份");
        importPreparedData(org, preparedData);
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
  document.getElementById("clearBtn").addEventListener("click", async () => {
    if (!await requestConfirm({ title: "清空当前组织", message: "将清空全部员工、考勤和薪资数据；操作前会自动创建恢复快照。", confirmText: "清空数据", danger: true })) return;
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
  document.getElementById("reportBtn").addEventListener("click", openCombinedExportModal);
}

function openCombinedExportModal() {
  const defaultMonth = document.getElementById("attMonth").value || curMonth();
  openModal(`
    <h3>导出综合 Excel 报表</h3>
    <p class="hint">花名册导出当前档案；考勤和薪资按月份分别生成工作表。一次最多连续 12 个月。</p>
    <div class="export-module-grid">
      <label><input type="checkbox" id="reportRoster" checked><span><b>花名册</b><small>当前员工档案与调休余额</small></span></label>
      <label><input type="checkbox" id="reportAttendance" checked><span><b>考勤</b><small>每个月一张考勤表</small></span></label>
      <label><input type="checkbox" id="reportPayroll" checked><span><b>薪资</b><small>每个月一张薪资表</small></span></label>
    </div>
    <div class="row export-month-range">
      <div class="field"><label>开始月份</label><input type="month" id="reportStart" value="${defaultMonth}"></div>
      <div class="field"><label>结束月份</label><input type="month" id="reportEnd" value="${defaultMonth}"></div>
    </div>
    <div class="hint" id="reportError" role="alert"></div>
    <div class="modal-actions">
      <button class="btn" id="reportCancel">取消</button>
      <button class="btn btn-primary" id="reportExport">生成 Excel</button>
    </div>`);
  document.getElementById("reportCancel").addEventListener("click", closeModal);
  document.getElementById("reportExport").addEventListener("click", () => {
    const modules = [
      document.getElementById("reportRoster").checked ? "roster" : "",
      document.getElementById("reportAttendance").checked ? "attendance" : "",
      document.getElementById("reportPayroll").checked ? "payroll" : ""
    ].filter(Boolean);
    try {
      const months = monthRange(document.getElementById("reportStart").value, document.getElementById("reportEnd").value);
      exportCombinedXlsx({ modules, months, orgName: getCurrentOrg()?.name || "当前组织" });
      closeModal();
      showToast(`综合报表已生成（${modules.length} 个模块，${months.length} 个月）`);
    } catch (error) {
      document.getElementById("reportError").textContent = error.message;
    }
  });
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
    "每天分 <b>上午 / 下午 / 加班</b> 三个时段：空格单击快捷录入，已有状态单击直接选择，<b>Shift + 单击</b>依次循环，拖动框选可批量设置",
    "普通工作日上午/下午不能选择加班，休息日可选择完整状态；加班行只允许<b>加 / 空</b>",
    "带时长的状态（调/年/事/病/缺/加/迟/退）格子里有蓝色「时长」角标，点它设 <b>小时/分钟</b>：加班默认 1 小时，迟到/早退默认 30 分钟，请假整段默认 4 小时",
    "选 <b>调</b> 从可调休余额扣对应分钟（余额=初始+加班累计−调休累计，动态计算，精确到分钟）；开启余额校验时，余额不足整段可改填实际时长，余额为零则不写入",
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
  bindPrivacyControls();     // 4.1) 临时隐藏当前页面中的敏感内容
  document.getElementById("modalMask").addEventListener("click", (e) => { if (e.target === e.currentTarget) closeModal(); });
  bindTabs();
  bindExport();              // 4.5) 各模块"导出 Excel"按钮
  bindResetColWidths();      // 4.55) 恢复默认列宽按钮
  bindGlobalKeys();          // 4.6) 弹窗 Esc 关闭 / Enter 保存
  bindHelp();                // 4.7) 帮助按钮（规则说明）
  applyOrgSettings(true);    // 4.8) 应用当前组织的界面偏好与默认月份
  renderAll();               // 5) 首次绘制全部内容
  showFirstUsePrivacyNotice(); // 6) 仅首次说明本地明文存储的使用边界
} catch (error) {
  showStartupError(error);
}

// #endregion 启动顺序
