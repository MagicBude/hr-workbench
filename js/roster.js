// ============================================================
// roster.js — 员工花名册模块
// ------------------------------------------------------------
// 负责：员工列表的展示与增删。
// 数据都来自 store.js 的 state.data.employees，改动后调用 persist() 保存。
// 任何一个模块改了数据，都通过 window.__renderAll() 让所有模块一起刷新。
// ============================================================

import { state, persist } from "./store.js";
import { fmtMoney } from "./ui.js";

// 初始化：只绑定一次“添加员工”按钮（它在页面上是固定存在的元素）
export function initRoster() {
  document.getElementById("addEmpBtn").addEventListener("click", () => {
    const name = document.getElementById("empName").value.trim();
    if (!name) { alert("请输入姓名"); return; }

    // 往员工数组里追加一条新记录
    state.data.employees.push({
      id: "e_" + Date.now(),                       // 用时间戳保证 id 不重复
      name,
      dept: document.getElementById("empDept").value.trim(),
      hireDate: document.getElementById("empHire").value,
      baseSalary: +document.getElementById("empSalary").value || 0
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

// 渲染：把员工数组画成表格
export function renderRoster() {
  const tb = document.querySelector("#empTable tbody");
  tb.innerHTML = "";

  if (!state.data.employees.length) {
    tb.innerHTML = '<tr><td colspan="5" class="empty">暂无员工，添加一条试试。</td></tr>';
    return;
  }

  state.data.employees.forEach(e => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${e.name}</td>
      <td>${e.dept}</td>
      <td>${e.hireDate || "-"}</td>
      <td class="num">${fmtMoney(e.baseSalary)}</td>
      <td><button class="btn btn-danger" style="min-height:34px;padding:0 10px;" data-del="${e.id}">删除</button></td>`;
    tb.appendChild(tr);
  });

  // 给每行“删除”按钮绑定事件
  tb.querySelectorAll("[data-del]").forEach(b => {
    b.addEventListener("click", () => {
      if (!confirm("确认删除该员工？相关考勤/薪资记录将保留但不再关联。")) return;
      state.data.employees = state.data.employees.filter(x => x.id !== b.dataset.del);
      persist();
      window.__renderAll();
    });
  });
}
