// ============================================================
// ui.js — 通用界面小工具
// ------------------------------------------------------------
// 这些功能在多个模块里都会用到（弹窗、文件下载、金额格式化、日期），
// 抽出来放一处，避免每个文件重复写一遍。
// 模块通过 export 把函数暴露出去，别的文件用 import 引入即可。
// ============================================================

// 打开弹窗：参数是弹窗内部的 HTML 字符串
export function openModal(html) {
  document.getElementById("modal").innerHTML = html;
  document.getElementById("modalMask").classList.add("show");
}
// 关闭弹窗
export function closeModal() {
  document.getElementById("modalMask").classList.remove("show");
}
// 点击弹窗外的灰色遮罩也能关闭
export function bindModalMask() {
  const mask = document.getElementById("modalMask");
  mask.addEventListener("click", (e) => {
    if (e.target === mask) closeModal();
  });
}

// 触发浏览器下载一个文件（导出 JSON / CSV 时用）
// content: 文件内容字符串；filename: 文件名；type: MIME 类型
export function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);   // 生成一个临时本地地址
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  a.click();                                // 模拟点击“下载”
  URL.revokeObjectURL(url);                 // 用完释放，避免内存泄漏
}

// 金额格式化：12345 -> "¥12,345"（数字加千位分隔，前面加人民币符号）
export function fmtMoney(n) {
  return "¥" + Math.round(n).toLocaleString("zh-CN");
}

// 当前年月，返回 "2026-08" 这样的字符串
export function curMonth() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}
// 今天是几号（数字），用于判断考勤是否“逾期”
export function curDay() {
  return new Date().getDate();
}

// 帮助弹窗：显示一组说明文字（计算规则 / 口径说明）
// title: 标题；lines: 字符串数组（可用 <b> 等行内标签）
export function showHelp(title, lines) {
  openModal(`<h3>${title}</h3><ul class="help-list">${lines.map(l => `<li>${l}</li>`).join("")}</ul>
    <div class="modal-actions"><button class="btn btn-primary" id="helpOk">知道了</button></div>`);
  document.getElementById("helpOk").addEventListener("click", closeModal);
}

// 轻提示（toast）：不打断操作的临时浮条，约 2.2 秒自动消失。
// 用于"调休余额不足已跳过"这类提醒——如果用 alert 弹窗会卡住点击循环。
let __toastTimer = null;
export function showToast(msg) {
  let t = document.getElementById("toast");
  if (!t) {                       // 第一次用时才创建这个 DOM 节点
    t = document.createElement("div");
    t.id = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");        // 触发淡入
  clearTimeout(__toastTimer);     // 连续提示时重置计时，避免提前消失
  __toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

// ============================================================
// enableColResize — Excel 式列宽拖拽（零依赖）
// ------------------------------------------------------------
// 在表头右侧加拖拽手柄，拖动改变 <colgroup><col> 的宽度；松手时把最新宽度数组
// 交给 onCommit 持久化。每个表头 <th> 需带 data-col="列序号"。
// 选项：
//   table    表格元素
//   widths   每列宽度数组(px)，长度需等于列数；为 null 时按当前渲染宽度测量
//   group(i) 第 i 列的“组标识”；同组一起变宽（如考勤日期列/汇总列统一调）。缺省每列独立
//   onCommit(widths) 松手回调，拿到最新宽度数组用于持久化
//   onResized(group)  每次宽度变化回调（如考勤固定列需同步 sticky 的 left 偏移）
//   min      最小列宽(px)，缺省 28
// ============================================================
export function enableColResize(opts) {
  const { table, group, onCommit, onResized, min = 28 } = opts;
  let widths = opts.widths ? opts.widths.slice() : null;

  // 强制固定布局：确保 colgroup 的宽度设置生效（CSS 可能因缓存/加载顺序没赶上）
  table.style.tableLayout = "fixed";

  // 收集表头单元格，并用 data-col 确定列序号（考勤双行表头同一列会有两个 th，取其一测量）
  const ths = [...table.querySelectorAll("thead th")];
  const byCol = {};
  ths.forEach(th => { const i = +th.dataset.col; if (!isNaN(i)) byCol[i] = th; });
  const ncols = Object.keys(byCol).length ? Math.max(...Object.keys(byCol).map(Number)) + 1 : ths.length;

  // 建立 colgroup 控制列宽
  let cg = table.querySelector("colgroup");
  if (!cg) { cg = document.createElement("colgroup"); table.insertBefore(cg, table.firstChild); }
  cg.innerHTML = "";
  const cols = [];
  for (let i = 0; i < ncols; i++) {
    const c = document.createElement("col");
    let w = widths ? widths[i] : null;
    if (w == null && byCol[i]) w = Math.round(byCol[i].getBoundingClientRect().width);
    if (w) { c.style.width = w + "px"; if (widths) widths[i] = w; }
    cg.appendChild(c);
    cols.push(c);
  }
  if (!widths) widths = cols.map((c, i) => parseFloat(c.style.width) || (byCol[i] ? Math.round(byCol[i].getBoundingClientRect().width) : min));

  // 每次重建 colgroup 后同步重建手柄。花名册的 thead 会复用，如果沿用旧手柄，
  // 其事件闭包仍指向已被 cg.innerHTML 清掉的旧 col，拖动就不会作用于当前表格。
  ths.forEach(th => {
    const oldHandle = th.querySelector(".col-resize");
    if (oldHandle) oldHandle.remove();
    const h = document.createElement("span");
    h.className = "col-resize";
    th.appendChild(h);
    h.addEventListener("mousedown", (e) => startResize(e, th, cols, widths, group, onCommit, onResized, min));
  });
}

// 拖拽过程：按住某列手柄，整组列同步变宽；松手回调 onCommit
function startResize(e, th, cols, widths, group, onCommit, onResized, min) {
  e.preventDefault();
  const ci = +th.dataset.col;
  const g = group ? group(ci) : ci;
  const same = (i) => (group ? group(i) : i) === g;
  const startX = e.clientX;
  const starts = {};
  cols.forEach((c, i) => { if (same(i)) starts[i] = parseFloat(c.style.width) || 0; });
  function move(ev) {
    const dx = ev.clientX - startX;
    cols.forEach((c, i) => {
      if (same(i)) {
        const w = Math.max(min, (starts[i] || 0) + dx);
        c.style.width = w + "px";
        widths[i] = w;
      }
    });
    if (onResized) onResized(g);   // 通知调用方（如重算 sticky 偏移）
  }
  function up() {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
    document.body.classList.remove("col-resizing");
    if (onCommit) onCommit(widths.slice());
  }
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
  document.body.classList.add("col-resizing");
}
