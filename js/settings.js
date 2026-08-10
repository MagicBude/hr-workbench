// ============================================================
// settings.js — 组织级设置中心
// ------------------------------------------------------------
// 所有设置跟随当前组织保存；界面只负责编辑，业务模块直接读取 state.data.settings。
// ============================================================

import { state, persist, getCurrentOrg, removePreference, createSnapshot, listSnapshots, restoreSnapshot, getStorageUsage } from "./store.js";
import { DEFAULT_SETTINGS, INSURANCE_RATIO, BIG_SICKNESS } from "./config.js";
import { openModal, closeModal, curMonth, showToast } from "./ui.js";
import { escapeHtml } from "./domain.js";

const COMP_KEYS = ["养老", "医疗", "工伤", "失业", "生育", "公积金"];
const PERS_KEYS = ["养老", "医疗", "失业", "公积金"];

function clone(v) { return JSON.parse(JSON.stringify(v)); }
function checked(v) { return v ? " checked" : ""; }
function ratioInputs(cls, keys, values) {
  return keys.map(k => `<div class="field"><label>${k}</label><input class="${cls}" data-k="${k}" type="number" step="0.001" min="0" max="1" value="${values[k] ?? 0}"></div>`).join("");
}

export function applyOrgSettings(resetMonths = false) {
  const st = state.data.settings || DEFAULT_SETTINGS;
  document.body.classList.toggle("compact-tables", !!st.compactTables);
  const today = document.getElementById("today");
  if (today) today.hidden = st.showTodayTodos === false;
  if (resetMonths) {
    const month = st.defaultMonth || curMonth();
    ["attMonth", "payMonth", "dashMonth"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = month;
    });
  }
}

export function initSettings() {
  document.getElementById("settingsBtn").addEventListener("click", () => openSettings());
}

export function openSettings(section = "attendance") {
  const st = state.data.settings || (state.data.settings = { ...DEFAULT_SETTINGS });
  const ratio = st.insuranceRatio || INSURANCE_RATIO;
  openModal(`
    <div class="settings-head">
      <div><h3>组织设置</h3><div class="hint">${escapeHtml(getCurrentOrg()?.name || "当前组织")} · 设置仅对本组织生效</div></div>
    </div>
    <div class="settings-tabs">
      <button class="active" data-settings-tab="attendance">考勤规则</button>
      <button data-settings-tab="features">功能开关</button>
      <button data-settings-tab="payroll">薪资参数</button>
      <button data-settings-tab="appearance">界面设置</button>
      <button data-settings-tab="safety">数据安全</button>
    </div>
    <div class="settings-page active" data-settings-page="attendance">
      <div class="settings-row"><div><b>半天标准工时</b><div class="hint">用于整段请假默认时长及调休扣减</div></div><div class="setting-input"><input id="setHalfHours" type="number" min="0.5" max="12" step="0.5" value="${st.halfDayMinutes / 60}"><span>小时</span></div></div>
      <label class="settings-row switch-row"><div><b>加班自动转调休</b><div class="hint">按实际加班分钟累计可调休余额</div></div><input id="setOtToRest" type="checkbox"${checked(st.overtimeToRest)}></label>
      <div class="settings-row"><div><b>加班转调休比例</b><div class="hint">例如 1.5 表示加班 1 小时增加 1.5 小时调休</div></div><div class="setting-input"><input id="setOtRatio" type="number" min="0" max="5" step="0.1" value="${st.overtimeToRestRatio}"><span>倍</span></div></div>
    </div>
    <div class="settings-page" data-settings-page="features">
      <label class="settings-row switch-row"><div><b>允许迟到 / 早退状态</b><div class="hint">关闭后考勤循环和批量工具不再提供“迟、退”</div></div><input id="setLateEarly" type="checkbox"${checked(st.enableLateEarly !== false)}></label>
      <label class="settings-row switch-row"><div><b>强制校验调休余额</b><div class="hint">关闭后允许调休余额为负数</div></div><input id="setRestCheck" type="checkbox"${checked(st.enforceRestBalance !== false)}></label>
      <label class="settings-row switch-row"><div><b>显示“今天要处理”</b><div class="hint">控制顶部考勤补录和薪资待核算提醒</div></div><input id="setToday" type="checkbox"${checked(st.showTodayTodos !== false)}></label>
    </div>
    <div class="settings-page" data-settings-page="payroll">
      <div class="hint">比例填写小数，例如 0.16 = 16%；以员工社保基数计算。</div>
      <div class="grp-title">公司缴纳</div><div class="ratio-grid">${ratioInputs("src", COMP_KEYS, ratio.company)}</div>
      <div class="grp-title">个人缴纳</div><div class="ratio-grid">${ratioInputs("srp", PERS_KEYS, ratio.personal)}
        <div class="field"><label>大病医疗(元/月)</label><input id="setBigSickness" type="number" min="0" step="1" value="${st.bigSickness ?? BIG_SICKNESS}"></div>
      </div>
    </div>
    <div class="settings-page" data-settings-page="appearance">
      <div class="settings-row"><div><b>默认月份</b><div class="hint">留空时使用当前月份，切换组织时生效</div></div><input id="setDefaultMonth" type="month" value="${st.defaultMonth || ""}"></div>
      <label class="settings-row switch-row"><div><b>紧凑表格</b><div class="hint">减少单元格留白，在一屏显示更多数据</div></div><input id="setCompact" type="checkbox"${checked(st.compactTables)}></label>
      <div class="settings-row"><div><b>调休余额显示</b><div class="hint">控制花名册中可调休余额的展示方式</div></div><select id="setRestDisplay" class="setting-select">
        <option value="smart"${st.restBalanceDisplay === "smart" ? " selected" : ""}>智能格式（2天3小时30分钟）</option>
        <option value="hours"${st.restBalanceDisplay === "hours" ? " selected" : ""}>总小时（19.5小时）</option>
        <option value="days"${st.restBalanceDisplay === "days" ? " selected" : ""}>天数小数（2.44天）</option>
      </select></div>
      <div class="settings-row"><div><b>列宽记忆</b><div class="hint">清除当前组织的花名册和考勤列宽</div></div><button class="btn" id="settingsResetCols">恢复默认列宽</button></div>
    </div>
    <div class="settings-page" data-settings-page="safety">
      <div class="settings-row"><div><b>本地存储占用</b><div class="hint">当前浏览器内全部组织与快照</div></div><span>${(getStorageUsage() / 1024).toFixed(1)} KB</span></div>
      <div class="settings-row"><div><b>数据快照</b><div class="hint">最多保留最近 10 份，导入、清空、回收前会自动创建</div></div><button class="btn" id="createSnapshotBtn">立即备份</button></div>
      <div class="grp-title">最近快照</div>
      <div class="snapshot-list">${listSnapshots().map(s => `<div class="settings-row"><div><b>${new Date(s.createdAt).toLocaleString()}</b><div class="hint">${escapeHtml(s.reason)}</div></div><button class="btn btn-sm" data-restore-snapshot="${s.id}">恢复</button></div>`).join("") || '<div class="empty">暂无快照</div>'}</div>
      <div class="grp-title">员工回收站</div>
      <div class="snapshot-list">${state.data.employees.filter(e => e.deletedAt).map(e => `<div class="settings-row"><div><b>${escapeHtml(e.name)}</b><div class="hint">${escapeHtml(e.dept || "无部门")}</div></div><button class="btn btn-sm" data-restore-emp="${e.id}">恢复</button></div>`).join("") || '<div class="empty">回收站为空</div>'}</div>
    </div>
    <div class="modal-actions settings-actions">
      <button class="btn" id="settingsCancel">取消</button>
      <button class="btn" id="settingsReset">全部恢复默认</button>
      <button class="btn btn-primary" id="settingsSave">保存设置</button>
    </div>`);
  document.getElementById("modal").classList.add("modal-wide");

  const activate = name => {
    document.querySelectorAll("[data-settings-tab]").forEach(b => b.classList.toggle("active", b.dataset.settingsTab === name));
    document.querySelectorAll("[data-settings-page]").forEach(p => p.classList.toggle("active", p.dataset.settingsPage === name));
  };
  document.querySelectorAll("[data-settings-tab]").forEach(b => b.addEventListener("click", () => activate(b.dataset.settingsTab)));
  activate(section);
  document.getElementById("settingsCancel").addEventListener("click", closeModal);
  document.getElementById("settingsResetCols").addEventListener("click", () => {
    removePreference("colw_emp");
    removePreference("colw_att");
    window.__renderAll();
    showToast("已清除当前组织的列宽记忆");
  });
  document.getElementById("settingsReset").addEventListener("click", () => {
    if (!confirm("确认将当前组织的全部设置恢复默认？员工和业务数据不会受影响。")) return;
    const departments = state.data.settings.departments || [];
    state.data.settings = { ...clone(DEFAULT_SETTINGS), departments, insuranceRatio: clone(INSURANCE_RATIO), bigSickness: BIG_SICKNESS };
    persist(); closeModal(); applyOrgSettings(true); window.__renderAll(); showToast("组织设置已恢复默认");
  });
  document.getElementById("settingsSave").addEventListener("click", saveSettings);
  document.getElementById("createSnapshotBtn").addEventListener("click", () => { createSnapshot("手动快照"); closeModal(); openSettings("safety"); showToast("数据快照已创建"); });
  document.querySelectorAll("[data-restore-snapshot]").forEach(b => b.addEventListener("click", () => {
    if (!confirm("恢复后当前数据会先自动备份。确认继续？")) return;
    restoreSnapshot(b.dataset.restoreSnapshot); closeModal(); window.__renderAll(); showToast("快照已恢复");
  }));
  document.querySelectorAll("[data-restore-emp]").forEach(b => b.addEventListener("click", () => {
    const emp = state.data.employees.find(e => e.id === b.dataset.restoreEmp); if (!emp) return;
    emp.deletedAt = null; persist(); closeModal(); window.__renderAll(); showToast("员工已恢复");
  }));
}

function saveSettings() {
  const halfHours = Number(document.getElementById("setHalfHours").value);
  const otRatio = Number(document.getElementById("setOtRatio").value);
  if (!(halfHours >= 0.5 && halfHours <= 12)) { alert("半天标准工时需在 0.5～12 小时之间"); return; }
  if (!(otRatio >= 0 && otRatio <= 5)) { alert("加班转调休比例需在 0～5 之间"); return; }
  const st = state.data.settings;
  st.halfDayMinutes = Math.round(halfHours * 60);
  st.overtimeToRest = document.getElementById("setOtToRest").checked;
  st.overtimeToRestRatio = otRatio;
  st.enableLateEarly = document.getElementById("setLateEarly").checked;
  st.enforceRestBalance = document.getElementById("setRestCheck").checked;
  st.showTodayTodos = document.getElementById("setToday").checked;
  st.compactTables = document.getElementById("setCompact").checked;
  st.defaultMonth = document.getElementById("setDefaultMonth").value;
  st.restBalanceDisplay = document.getElementById("setRestDisplay").value;
  const nr = { company: {}, personal: {} };
  document.querySelectorAll(".src").forEach(i => nr.company[i.dataset.k] = Math.max(0, Number(i.value) || 0));
  document.querySelectorAll(".srp").forEach(i => nr.personal[i.dataset.k] = Math.max(0, Number(i.value) || 0));
  st.insuranceRatio = nr;
  st.bigSickness = Math.max(0, Number(document.getElementById("setBigSickness").value) || 0);
  persist(); closeModal(); applyOrgSettings(true); window.__renderAll(); showToast("组织设置已保存");
}
