/*
 * roster.js — 员工档案与生命周期页面
 *
 * 输入：员工数组、组织部门列表、筛选条件和员工表单值。
 * 输出：员工表格及新增、编辑、排序、离职归档和回收后的员工数据。
 * 协作：store.js 持久化并计算调休余额，domain.js 提供状态与安全文本处理，
 * 考勤、薪资和看板在员工变化后同步刷新。
 *
 * 关键约束：回收员工不能删除历史记录；可调休余额由初始值和考勤动态计算，
 * 不能再维护一份容易漂移的“当前余额”。
 */

import { state, persist, getDepartments, addDepartment, computeRestMinutes, loadPreference, savePreference, removePreference, createSnapshot } from "./store.js";
import { HALF_DAY_MINUTES } from "./config.js";
import { fmtMoney, openModal, closeModal, enableColResize, normalizeColumnWidths, requestRefresh, requestText, requestConfirm } from "./ui.js";
import { escapeHtml, EMPLOYMENT_STATUS, requireNonNegativeNumber } from "./domain.js";
import { createId } from "./ids.js";

// #region 调休显示、列宽与筛选状态
// 列宽持久化（按组织）：存在 localStorage 的 wb_hr_{org}_colw_{tag}
// 花名册默认列宽（序号/姓名/部门/入职/月薪/可调休/操作）
const EMP_DEF_W = [44, 110, 120, 120, 80, 110, 110, 160];

function workdayMinutes() {
  const half = (state.data.settings && state.data.settings.halfDayMinutes) || HALF_DAY_MINUTES;
  return half * 2;
}
function shortDecimal(n, digits = 2) {
  return String(Math.round(n * (10 ** digits)) / (10 ** digits));
}
function formatRestMinutes(minutes, mode = (state.data.settings && state.data.settings.restBalanceDisplay) || "smart") {
  const value = Math.round(minutes || 0);
  const sign = value < 0 ? "−" : "";
  const abs = Math.abs(value);
  const dayMin = workdayMinutes();
  if (mode === "hours") return sign + shortDecimal(abs / 60) + "小时";
  if (mode === "days") return sign + shortDecimal(abs / dayMin) + "天";
  if (abs === 0) return "—";
  const days = Math.floor(abs / dayMin);
  const rest = abs - days * dayMin;
  const hours = Math.floor(rest / 60);
  const mins = rest % 60;
  return sign + (days ? days + "天" : "") + (hours ? hours + "小时" : "") + (mins ? mins + "分钟" : "");
}

// 恢复默认列宽：清除记忆并刷新
export function resetEmpColWidths() {
  removePreference("colw_emp");
  requestRefresh("roster");
}

// 花名册筛选项（仅内存，不持久化）：按姓名模糊匹配 + 按部门精确匹配
let rosterFilter = { name: "", dept: "", status: "current" };

// #endregion 调休显示、列宽与筛选状态

// #region 部门选项

// —— 小工具：转义，避免部门名里的引号/尖括号破坏 HTML ——
// 生成部门下拉的 <option>（含「无部门」和「➕ 新增部门」）
function deptOptionsHtml(selected, withNew) {
  const depts = getDepartments();
  let html = '<option value="">（无部门）</option>';
  depts.forEach(d => {
    const sel = d === selected ? " selected" : "";
    html += `<option value="${escapeHtml(d)}"${sel}>${escapeHtml(d)}</option>`;
  });
  if (withNew !== false) html += '<option value="__new__">➕ 新增部门…</option>';
  return html;
}
// 给某个部门下拉绑定「新增部门」逻辑：选到「➕ 新增部门」时弹窗输入并写入组织级部门列表
function wireNewDept(selEl) {
  selEl.addEventListener("change", async () => {
    if (selEl.value !== "__new__") return;
    const name = await requestText({
      title: "新增部门", label: "部门名称", placeholder: "例如：销售部", maxLength: 100,
      validate: value => !value ? "请输入部门名称" : (getDepartments().includes(value) ? "该部门已经存在" : "")
    });
    if (name) {
      addDepartment(name);                       // 写入 settings.departments 并保存
      selEl.innerHTML = deptOptionsHtml(name);
      selEl.value = name;
    } else {
      selEl.innerHTML = deptOptionsHtml("");
      selEl.value = "";
    }
    refreshDeptSelects();                         // 同步刷新筛选下拉
  });
}
// 重新填充所有「筛选用」部门下拉（新增部门后调用，保留当前选择）
function refreshDeptSelects() {
  ["empFilterDept", "attFilterDept"].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">全部部门</option>'
      + getDepartments().map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");
    sel.value = cur;
  });
}
// 同步「新增表单」的部门下拉（切换组织后部门列表变了，需要重建并保留当前选择）
function syncAddDeptSelect() {
  const sel = document.getElementById("empDept");
  if (!sel) return;
  const depts = getDepartments();
  const want = depts.length + 2;   // （无部门） + 各部门 + ➕新增部门
  if (sel.options.length !== want) {
    const cur = sel.value;
    sel.innerHTML = deptOptionsHtml(cur === "__new__" ? "" : cur);
    if (cur === "" || depts.includes(cur)) sel.value = cur;
  }
}

// #endregion 部门选项

// #region 初始化与新增员工

// 初始化：只绑定一次“添加员工”按钮（它在页面上是固定存在的元素）
export function initRoster() {
  document.getElementById("toggleAddEmpBtn").addEventListener("click", () => {
    const form = document.getElementById("addEmployeeForm");
    form.hidden = !form.hidden;
    document.getElementById("toggleAddEmpBtn").textContent = form.hidden ? "＋ 新增员工" : "收起新增表单";
    if (!form.hidden) document.getElementById("empName").focus();
  });
  // 部门下拉：用组织级部门列表填充（新增表单）
  const deptSel = document.getElementById("empDept");
  deptSel.innerHTML = deptOptionsHtml("");
  wireNewDept(deptSel);

  // 筛选下拉：姓名 + 部门
  const fn = document.getElementById("empFilterName");
  const fd = document.getElementById("empFilterDept");
  fd.innerHTML = '<option value="">全部部门</option>'
    + getDepartments().map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");
  fn.addEventListener("input", () => { rosterFilter.name = fn.value; renderRoster(); });
  fd.addEventListener("change", () => { rosterFilter.dept = fd.value; renderRoster(); });
  document.getElementById("empFilterStatus").addEventListener("change", ev => { rosterFilter.status = ev.target.value; renderRoster(); });

  document.getElementById("addEmpBtn").addEventListener("click", () => {
    const name = document.getElementById("empName").value.trim();
    if (!name) { alert("请输入姓名"); return; }
    let baseSalary;
    try {
      baseSalary = requireNonNegativeNumber(document.getElementById("empSalary").value || 0, "基本月薪");
    } catch (error) {
      alert(error.message);
      return;
    }

    // 往员工数组里追加一条新记录（新增员工默认无调休余额、社保基数用月薪）
    state.data.employees.push({
      id: createId("e"),
      name,
      dept: document.getElementById("empDept").value.trim(),
      hireDate: document.getElementById("empHire").value,
      baseSalary,
      restSeedMinutes: 0,     // 初始可调休余额（分钟），新增默认 0；可用=初始+加班−调休 动态算
      insuranceBase: null    // 社保基数，null = 用基本月薪
      ,employmentStatus: "active", leaveDate: "", deletedAt: null
    });

    // 清空输入框，方便继续添加
    document.getElementById("empName").value = "";
    document.getElementById("empDept").value = "";
    document.getElementById("empHire").value = "";
    document.getElementById("empSalary").value = "";

    persist();              // 保存到存储
    requestRefresh("roster", "attendance", "payroll", "dashboard", "today");
  });
}

// #endregion 初始化与新增员工

// #region 花名册渲染与行操作

// 渲染：把员工数组画成表格（带序号、可调休、编辑/删除、拖拽手柄）
export function renderRoster() {
  const tb = document.querySelector("#empTable tbody");
  tb.innerHTML = "";
  syncAddDeptSelect();      // 切换组织后同步部门下拉
  refreshDeptSelects();    // 同步筛选用部门下拉（保留当前选择）

  if (!state.data.employees.filter(e => !e.deletedAt).length) {
    tb.innerHTML = '<tr><td colspan="8" class="empty">暂无员工，添加一条试试。</td></tr>';
    return;
  }

  // 应用筛选：姓名模糊匹配 + 部门精确匹配
  const q = rosterFilter.name.trim().toLowerCase();
  const list = state.data.employees.filter(e =>
    !e.deletedAt &&
    (!q || e.name.toLowerCase().includes(q)) &&
    (!rosterFilter.dept || e.dept === rosterFilter.dept) &&
    (rosterFilter.status === "all" || (rosterFilter.status === "current" ? ["active", "probation", "suspended"].includes(e.employmentStatus || "active") : (e.employmentStatus || "active") === rosterFilter.status))
  );
  // 更新筛选计数提示
  const cnt = document.getElementById("empFilterCount");
  if (cnt) cnt.textContent = `共 ${list.length} / ${state.data.employees.filter(e => !e.deletedAt).length} 人`;

  if (!list.length) {
    tb.innerHTML = '<tr><td colspan="8" class="empty">没有匹配的员工</td></tr>';
    return;
  }

  list.forEach((e, i) => {
    const tr = document.createElement("tr");
    tr.draggable = true;                 // 允许整行被拖拽
    tr.dataset.id = e.id;                // 记员工 id（拖拽时按 id 定位，兼容筛选后的顺序）
    const restMinutes = computeRestMinutes(e.id);
    tr.innerHTML = `
      <td class="seq">${i + 1}</td>
      <td><span class="drag-handle" title="拖拽排序">≡</span>${escapeHtml(e.name)}</td>
      <td>${escapeHtml(e.dept || "")}</td>
      <td>${e.hireDate || "-"}</td>
      <td><span class="status-badge status-${e.employmentStatus || "active"}">${EMPLOYMENT_STATUS[e.employmentStatus || "active"]}</span></td>
      <td class="num">${fmtMoney(e.baseSalary)}</td>
      <td class="num mono${restMinutes < 0 ? " rest-overdrawn" : ""}" title="${shortDecimal(restMinutes / 60)} 小时">${formatRestMinutes(restMinutes)}${restMinutes < 0 ? '<span class="overdrawn-label">已透支</span>' : ""}</td>
      <td class="ops">
        <button class="btn btn-sm" data-edit="${e.id}">编辑</button>
        ${e.employmentStatus !== "departed" ? `<button class="btn btn-sm" data-depart="${e.id}">离职归档</button>` : ""}
        <button class="btn btn-sm btn-danger btn-quiet-danger" data-del="${e.id}">回收</button>
      </td>`;
    tb.appendChild(tr);
  });

  bindDnD(tb);   // 绑定拖拽交换

  // 给每行“删除”按钮绑定事件
  tb.querySelectorAll("[data-del]").forEach(b => {
    b.addEventListener("click", async () => {
      if (!await requestConfirm({ title: "回收员工", message: "该员工将从当前列表隐藏，历史考勤和薪资保留，可在设置中心恢复。", confirmText: "移入回收站", danger: true })) return;
      createSnapshot("员工移入回收站前");
      const emp = state.data.employees.find(x => x.id === b.dataset.del);
      if (emp) emp.deletedAt = new Date().toISOString();
      persist();
      requestRefresh("roster", "attendance", "payroll", "dashboard", "today");
    });
  });
  tb.querySelectorAll("[data-depart]").forEach(b => b.addEventListener("click", async () => {
    if (!await requestConfirm({ title: "员工离职归档", message: "员工将标记为离职，全部历史考勤和薪资继续保留。", confirmText: "确认离职", danger: true })) return;
    const emp = state.data.employees.find(x => x.id === b.dataset.depart);
    if (!emp) return;
    emp.employmentStatus = "departed";
    emp.leaveDate ||= new Date().toISOString().slice(0, 10);
    persist(); requestRefresh("roster", "attendance", "payroll", "dashboard", "today");
  }));
  // 给每行“编辑”按钮绑定事件
  tb.querySelectorAll("[data-edit]").forEach(b => {
    b.addEventListener("click", () => openEditModal(b.dataset.edit));
  });

  // 启用列宽拖拽（Excel 式），宽度按组织记忆
  enableColResize({
    table: document.getElementById("empTable"),
    widths: normalizeColumnWidths(loadPreference("colw_emp"), EMP_DEF_W, { min: 40 }),
    onCommit: (w) => savePreference("colw_emp", w),
    min: 40
  });
}

// #endregion 花名册渲染与行操作

// #region 拖拽排序

// 拖拽排序：拖起一行 → 放到另一行 → 交换两行在数组里的位置
function bindDnD(tb) {
  let dragId = null;   // 当前被拖拽的员工 id（用 id 而非行号，兼容筛选后的顺序）
  tb.querySelectorAll("tr").forEach(tr => {
    // 拖拽开始：记住起点 + 加半透明样式
    tr.addEventListener("dragstart", (ev) => {
      dragId = tr.dataset.id;
      tr.classList.add("dragging");
      ev.dataTransfer.effectAllowed = "move";
    });
    // 拖拽经过：必须 preventDefault 才允许“放下”
    tr.addEventListener("dragover", (ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; });
    // 放下：与目标行交换位置
    tr.addEventListener("drop", (ev) => {
      ev.preventDefault();
      const overId = tr.dataset.id;
      if (overId !== dragId && dragId !== null) {
        const arr = state.data.employees;
        const from = arr.findIndex(x => x.id === dragId);
        const to = arr.findIndex(x => x.id === overId);
        if (from !== -1 && to !== -1) {
          const [moved] = arr.splice(from, 1);  // 取出被拖的行
          arr.splice(to, 0, moved);             // 插入到目标位置
          persist();
          requestRefresh("roster");
        }
      }
      dragId = null;
    });
    // 拖拽结束：去掉样式
    tr.addEventListener("dragend", () => tr.classList.remove("dragging"));
  });
}

// #endregion 拖拽排序

// #region 员工编辑

// 编辑弹窗：修改员工全部字段（含可调休余额、社保基数）
function openEditModal(id) {
  const e = state.data.employees.find(x => x.id === id);
  if (!e) return;
  const seedMinutes = Math.max(0, e.restSeedMinutes || 0);
  const dayMinutes = workdayMinutes();
  const restDays = Math.floor(seedMinutes / dayMinutes);
  const seedRemainder = seedMinutes - restDays * dayMinutes;
  const restHours = Math.floor(seedRemainder / 60);
  const restMins = seedRemainder % 60;
  const earnedUsedMinutes = computeRestMinutes(e.id) - seedMinutes;
  openModal(`
    <h3>编辑员工</h3>
    <div class="field"><label>姓名</label><input id="emName" value="${escapeHtml(e.name)}"></div>
    <div class="field"><label>部门</label><select id="emDept">${deptOptionsHtml(e.dept)}</select></div>
    <div class="field"><label>入职日期</label><input id="emHire" type="date" value="${e.hireDate || ""}"></div>
    <div class="field"><label>在职状态</label><select id="emStatus">${Object.entries(EMPLOYMENT_STATUS).map(([v,l]) => `<option value="${v}" ${e.employmentStatus === v ? "selected" : ""}>${l}</option>`).join("")}</select></div>
    <div class="field"><label>离职日期</label><input id="emLeave" type="date" value="${e.leaveDate || ""}"></div>
    <div class="field"><label>基本月薪 (¥)</label><input id="emSalary" type="number" min="0" value="${e.baseSalary || 0}"></div>
    <div class="field"><label>初始可调休余额</label>
      <div class="rest-duration-grid">
        <label><input id="emRestDays" type="number" min="0" step="1" value="${restDays}"><span>天</span></label>
        <label><input id="emRestHours" type="number" min="0" step="1" value="${restHours}"><span>小时</span></label>
        <label><input id="emRestMins" type="number" min="0" max="59" step="1" value="${restMins}"><span>分钟</span></label>
      </div>
    </div>
    <div class="hint" id="emRestHint"></div>
    <div class="field"><label>社保基数 (¥，留空=用基本月薪)</label><input id="emIns" type="number" min="0" value="${e.insuranceBase ?? ""}"></div>
    <div class="modal-actions">
      <button class="btn" id="emCancel">取消</button>
      <button class="btn btn-primary" id="emSave">保存</button>
    </div>`);
  document.getElementById("emCancel").addEventListener("click", closeModal);
  const readRestMinutes = () => {
    const days = Math.max(0, Math.floor(+document.getElementById("emRestDays").value || 0));
    const hours = Math.max(0, Math.floor(+document.getElementById("emRestHours").value || 0));
    const mins = Math.max(0, Math.min(59, Math.floor(+document.getElementById("emRestMins").value || 0)));
    return days * dayMinutes + hours * 60 + mins;
  };
  const updateRestHint = () => {
    const inputMinutes = readRestMinutes();
    const available = inputMinutes + earnedUsedMinutes;
    document.getElementById("emRestHint").innerHTML = `录入：<b>${formatRestMinutes(inputMinutes, "smart")}</b> = ${shortDecimal(inputMinutes / 60)} 小时；保存后可用：<b>${formatRestMinutes(available, "smart")}</b>`;
  };
  ["emRestDays", "emRestHours", "emRestMins"].forEach(id => document.getElementById(id).addEventListener("input", updateRestHint));
  updateRestHint();
  document.getElementById("emSave").addEventListener("click", () => {
    let baseSalary, insuranceBase;
    try {
      baseSalary = requireNonNegativeNumber(document.getElementById("emSalary").value, "基本月薪");
      const insuranceInput = document.getElementById("emIns").value.trim();
      insuranceBase = insuranceInput === "" ? null : requireNonNegativeNumber(insuranceInput, "社保基数");
    } catch (error) {
      alert(error.message);
      return;
    }
    e.name = document.getElementById("emName").value.trim() || e.name;
    e.dept = document.getElementById("emDept").value.trim();
    e.hireDate = document.getElementById("emHire").value;
    e.employmentStatus = document.getElementById("emStatus").value;
    e.leaveDate = document.getElementById("emLeave").value;
    e.baseSalary = baseSalary;
    // 可调休初始余额：天 / 小时 / 分钟 → 分钟；可用余额仍由考勤动态计算
    e.restSeedMinutes = readRestMinutes();
    // 社保基数：空 → null（用基本月薪）；否则取数字
    e.insuranceBase = insuranceBase;
    persist();
    closeModal();
    requestRefresh("roster", "attendance", "payroll", "dashboard", "today");
  });
  // 编辑弹窗里的部门下拉同样支持「➕ 新增部门」
  wireNewDept(document.getElementById("emDept"));
}

// #endregion 员工编辑
