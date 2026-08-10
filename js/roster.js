// ============================================================
// roster.js — 员工花名册模块
// ------------------------------------------------------------
// 负责：员工列表的展示、新增、编辑、删除、拖拽排序。
// 数据都来自 store.js 的 state.data.employees，改动后调用 persist() 保存。
// 任何一个模块改了数据，都通过 window.__renderAll() 让所有模块一起刷新。
//
// Phase 1 新增能力：
//   - 行号（一眼看总人数）
//   - “编辑”按钮（修改姓名/部门/入职日期/月薪/可调休余额/社保基数）
//   - 拖拽排序（HTML5 Drag & Drop）
//   - 可调休余额字段（精确到分钟，在考勤选调修时联动扣减）
// ============================================================

import { state, persist } from "./store.js";
import { fmtMoney, openModal, closeModal } from "./ui.js";

// 初始化：只绑定一次“添加员工”按钮（它在页面上是固定存在的元素）
export function initRoster() {
  document.getElementById("addEmpBtn").addEventListener("click", () => {
    const name = document.getElementById("empName").value.trim();
    if (!name) { alert("请输入姓名"); return; }

    // 往员工数组里追加一条新记录（新增员工默认无调休余额、社保基数用月薪）
    state.data.employees.push({
      id: "e_" + Date.now(),                       // 用时间戳保证 id 不重复
      name,
      dept: document.getElementById("empDept").value.trim(),
      hireDate: document.getElementById("empHire").value,
      baseSalary: +document.getElementById("empSalary").value || 0,
      restMinutes: 0,        // 可调休余额（分钟），新增默认 0
      insuranceBase: null    // 社保基数，null = 用基本月薪
    });

    // 清空输入框，方便继续添加
    document.getElementById("empName").value = "";
    document.getElementById("empDept").value = "";
    document.getElementById("empHire").value = "";
    document.getElementById("empSalary").value = "";

    persist();              // 保存到存储
    window.__renderAll();   // 刷新所有模块（含考勤/薪资/看板/今天要处理）
  });
}

// 渲染：把员工数组画成表格（带序号、可调休、编辑/删除、拖拽手柄）
export function renderRoster() {
  const tb = document.querySelector("#empTable tbody");
  tb.innerHTML = "";

  if (!state.data.employees.length) {
    tb.innerHTML = '<tr><td colspan="7" class="empty">暂无员工，添加一条试试。</td></tr>';
    return;
  }

  state.data.employees.forEach((e, i) => {
    const tr = document.createElement("tr");
    tr.draggable = true;                 // 允许整行被拖拽
    tr.dataset.index = i;                // 记下原始顺序，拖拽时用来计算交换
    const restHours = (e.restMinutes || 0) / 60;  // 分钟 → 小时，便于阅读
    tr.innerHTML = `
      <td class="seq">${i + 1}</td>
      <td><span class="drag-handle" title="拖拽排序">≡</span>${e.name}</td>
      <td>${e.dept}</td>
      <td>${e.hireDate || "-"}</td>
      <td class="num">${fmtMoney(e.baseSalary)}</td>
      <td class="num">${restHours.toFixed(1)}</td>
      <td class="ops">
        <button class="btn btn-sm" data-edit="${e.id}">编辑</button>
        <button class="btn btn-sm btn-danger" data-del="${e.id}">删除</button>
      </td>`;
    tb.appendChild(tr);
  });

  bindDnD(tb);   // 绑定拖拽交换

  // 给每行“删除”按钮绑定事件
  tb.querySelectorAll("[data-del]").forEach(b => {
    b.addEventListener("click", () => {
      if (!confirm("确认删除该员工？相关考勤/薪资记录将保留但不再关联。")) return;
      state.data.employees = state.data.employees.filter(x => x.id !== b.dataset.del);
      persist();
      window.__renderAll();
    });
  });
  // 给每行“编辑”按钮绑定事件
  tb.querySelectorAll("[data-edit]").forEach(b => {
    b.addEventListener("click", () => openEditModal(b.dataset.edit));
  });
}

// 拖拽排序：拖起一行 → 放到另一行 → 交换两行在数组里的位置
function bindDnD(tb) {
  let dragIdx = null;   // 当前被拖拽的行序号
  tb.querySelectorAll("tr").forEach(tr => {
    // 拖拽开始：记住起点 + 加半透明样式
    tr.addEventListener("dragstart", (ev) => {
      dragIdx = +tr.dataset.index;
      tr.classList.add("dragging");
      ev.dataTransfer.effectAllowed = "move";
    });
    // 拖拽经过：必须 preventDefault 才允许“放下”
    tr.addEventListener("dragover", (ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; });
    // 放下：与目标行交换位置
    tr.addEventListener("drop", (ev) => {
      ev.preventDefault();
      const overIdx = +tr.dataset.index;
      if (overIdx !== dragIdx && dragIdx !== null) {
        const arr = state.data.employees;
        const [moved] = arr.splice(dragIdx, 1);  // 取出被拖的行
        arr.splice(overIdx, 0, moved);           // 插入到目标位置
        persist();
        window.__renderAll();                     // 重绘（序号会重新排）
      }
      dragIdx = null;
    });
    // 拖拽结束：去掉样式
    tr.addEventListener("dragend", () => tr.classList.remove("dragging"));
  });
}

// 编辑弹窗：修改员工全部字段（含可调休余额、社保基数）
function openEditModal(id) {
  const e = state.data.employees.find(x => x.id === id);
  if (!e) return;
  const restHours = (e.restMinutes || 0) / 60;   // 分钟 → 小时回填到输入框
  openModal(`
    <h3>编辑员工</h3>
    <div class="field"><label>姓名</label><input id="emName" value="${e.name}"></div>
    <div class="field"><label>部门</label><input id="emDept" value="${e.dept || ""}"></div>
    <div class="field"><label>入职日期</label><input id="emHire" type="date" value="${e.hireDate || ""}"></div>
    <div class="field"><label>基本月薪 (¥)</label><input id="emSalary" type="number" min="0" value="${e.baseSalary || 0}"></div>
    <div class="field"><label>可调休余额 (小时)</label><input id="emRest" type="number" min="0" step="0.5" value="${restHours}"></div>
    <div class="field"><label>社保基数 (¥，留空=用基本月薪)</label><input id="emIns" type="number" min="0" value="${e.insuranceBase ?? ""}"></div>
    <div class="modal-actions">
      <button class="btn" id="emCancel">取消</button>
      <button class="btn btn-primary" id="emSave">保存</button>
    </div>`);
  document.getElementById("emCancel").addEventListener("click", closeModal);
  document.getElementById("emSave").addEventListener("click", () => {
    e.name = document.getElementById("emName").value.trim() || e.name;
    e.dept = document.getElementById("emDept").value.trim();
    e.hireDate = document.getElementById("emHire").value;
    e.baseSalary = +document.getElementById("emSalary").value || 0;
    // 可调休：小时 → 分钟（精确到分钟存储）
    e.restMinutes = Math.round((+document.getElementById("emRest").value || 0) * 60);
    // 社保基数：空 → null（用基本月薪）；否则取数字
    const ins = document.getElementById("emIns").value.trim();
    e.insuranceBase = ins === "" ? null : (+ins || 0);
    persist();
    closeModal();
    window.__renderAll();
  });
}
