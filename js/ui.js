/*
 * ui.js — 与业务无关的通用界面工具
 *
 * 输入：弹窗模板、下载内容、日期/金额及表格列宽配置。
 * 输出：公共弹窗、Toast、文件下载、格式化文本和列宽拖拽行为。
 * 协作：各页面模块调用这里的 UI 能力；requestRefresh 通过 main.js 的全局入口调度视图。
 *
 * 修改注意：openModal 目前只接收项目内部可信模板；列宽工具会重建 colgroup，
 * 因此必须同时重绑拖拽手柄，不能保留指向旧 <col> 的事件闭包。
 */

// #region 弹窗与文件下载

// 打开弹窗：参数是弹窗内部的 HTML 字符串
export function openModal(html) {
  const modal = document.getElementById("modal");
  modal.className = "modal";
  modal.innerHTML = html;
  document.getElementById("modalMask").classList.add("show");
}
// 关闭弹窗
export function closeModal() {
  document.getElementById("modalMask").classList.remove("show");
}

// 统一文本输入弹窗。用户输入始终通过 value/textContent 进入 DOM，validate 返回
// 错误文字或空字符串；Promise 的 null 表示取消，字符串表示通过校验的结果。
export function requestText({ title, label, initialValue = "", placeholder = "", maxLength = 100, validate }) {
  return new Promise(resolve => {
    const modal = document.getElementById("modal");
    const hadParentModal = document.getElementById("modalMask").classList.contains("show");
    const parentClassName = modal.className;
    const parentContent = document.createDocumentFragment();
    if (hadParentModal) parentContent.append(...modal.childNodes);
    openModal(`
      <h3 id="textPromptTitle"></h3>
      <div class="field"><label id="textPromptLabel"></label>
        <input id="textPromptInput">
        <div class="hint" id="textPromptError" role="alert"></div>
      </div>
      <div class="modal-actions">
        <button class="btn" id="textPromptCancel">取消</button>
        <button class="btn btn-primary" id="textPromptSave">确定</button>
      </div>`);
    const input = document.getElementById("textPromptInput");
    const errorBox = document.getElementById("textPromptError");
    document.getElementById("textPromptTitle").textContent = title;
    document.getElementById("textPromptLabel").textContent = label;
    input.value = initialValue;
    input.placeholder = placeholder;
    input.maxLength = maxLength;
    const finish = value => {
      document.removeEventListener("keydown", cancelOnEscape, true);
      if (hadParentModal) {
        modal.className = parentClassName;
        modal.replaceChildren(parentContent);
      } else {
        closeModal();
      }
      resolve(value);
    };
    const cancelOnEscape = event => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finish(null);
    };
    document.addEventListener("keydown", cancelOnEscape, true);
    document.getElementById("textPromptCancel").addEventListener("click", () => {
      finish(null);
    });
    document.getElementById("textPromptSave").addEventListener("click", () => {
      const value = input.value.trim();
      const error = validate ? validate(value) : "";
      if (error) { errorBox.textContent = error; input.focus(); return; }
      finish(value);
    });
    input.focus();
    input.select();
  });
}

// 统一确认弹窗，danger=true 时用危险按钮强调不可逆操作。与 requestText 一样，
// 若从现有弹窗内打开，会暂存并恢复父弹窗节点及其事件监听器。
export function requestConfirm({ title, message, confirmText = "确认", danger = false }) {
  return new Promise(resolve => {
    const modal = document.getElementById("modal");
    const hadParentModal = document.getElementById("modalMask").classList.contains("show");
    const parentClassName = modal.className;
    const parentContent = document.createDocumentFragment();
    if (hadParentModal) parentContent.append(...modal.childNodes);
    openModal(`
      <h3 id="confirmTitle"></h3>
      <p id="confirmMessage"></p>
      <div class="modal-actions">
        <button class="btn" id="confirmCancel">取消</button>
        <button class="btn ${danger ? "btn-danger" : "btn-primary"}" id="confirmOk"></button>
      </div>`);
    document.getElementById("confirmTitle").textContent = title;
    document.getElementById("confirmMessage").textContent = message;
    document.getElementById("confirmOk").textContent = confirmText;
    const finish = value => {
      document.removeEventListener("keydown", cancelOnEscape, true);
      if (hadParentModal) { modal.className = parentClassName; modal.replaceChildren(parentContent); }
      else closeModal();
      resolve(value);
    };
    const cancelOnEscape = event => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopImmediatePropagation(); finish(false);
    };
    document.addEventListener("keydown", cancelOnEscape, true);
    document.getElementById("confirmCancel").addEventListener("click", () => finish(false));
    document.getElementById("confirmOk").addEventListener("click", () => finish(true));
    document.getElementById("confirmOk").focus();
  });
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

// #endregion 弹窗与文件下载

// #region 格式化、帮助与反馈

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

// 业务模块只声明受影响的视图，不直接依赖入口模块，避免循环 import。
// 入口尚未完成初始化时回退为全量刷新，保证独立调用也不会静默失效。
export function requestRefresh(...modules) {
  if (typeof window.__refresh === "function") window.__refresh(...modules);
  else if (typeof window.__renderAll === "function") window.__renderAll();
}

// #endregion 格式化、帮助与反馈

// #region 表格列宽拖拽

// 持久化偏好来自 localStorage，可能被旧版本、手工修改或损坏数据污染。
// 这里要求“数量完全一致且全部为有限数”；只要一项不合法就整体恢复默认值，
// 避免一半使用旧偏好、一半使用默认值后形成难以理解的错位。
export function normalizeColumnWidths(value, defaults, { min = 28, max = 600 } = {}) {
  const valid = Array.isArray(value)
    && value.length === defaults.length
    && value.every(width => Number.isFinite(width));
  const source = valid ? value : defaults;
  return source.map(width => Math.min(max, Math.max(min, width)));
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
  const { table, group, onCommit, onResized, min = 28, max = 600 } = opts;
  let widths = opts.widths ? opts.widths.slice() : null;

  // 强制固定布局：确保 colgroup 的宽度设置生效（CSS 可能因缓存/加载顺序没赶上）
  table.style.tableLayout = "fixed";

  // 收集表头单元格，并用 data-col 确定列序号（考勤双行表头同一列会有两个 th，取其一测量）
  const ths = [...table.querySelectorAll("thead th")];
  const byCol = {};
  ths.forEach(th => { const i = +th.dataset.col; if (!isNaN(i)) byCol[i] = th; });
  const ncols = Object.keys(byCol).length ? Math.max(...Object.keys(byCol).map(Number)) + 1 : ths.length;

  // 调用方通常会提供默认宽度。若偏好数量或数值异常，不能让 undefined、NaN、
  // Infinity 进入样式；放弃整组偏好后再按实际表头测量。
  if (widths && (widths.length !== ncols || widths.some(width => !Number.isFinite(width)))) widths = null;
  if (widths) widths = widths.map(width => Math.min(max, Math.max(min, width)));

  // 建立 colgroup 控制列宽
  let cg = table.querySelector("colgroup");
  if (!cg) { cg = document.createElement("colgroup"); table.insertBefore(cg, table.firstChild); }
  cg.innerHTML = "";
  const cols = [];
  for (let i = 0; i < ncols; i++) {
    const c = document.createElement("col");
    let w = widths ? widths[i] : null;
    if (w == null && byCol[i]) {
      const measured = Math.round(byCol[i].getBoundingClientRect().width);
      w = measured > 0 ? Math.min(max, Math.max(min, measured)) : min;
    }
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
    // colspan 分组标题只负责表达层级，没有对应单一 <col>；拖拽手柄只绑定实际叶子列。
    if (!Number.isInteger(Number(th.dataset.col))) return;
    const h = document.createElement("span");
    h.className = "col-resize";
    th.appendChild(h);
    h.addEventListener("mousedown", (e) => startResize(e, th, cols, widths, group, onCommit, onResized, min, max));
  });
}

// 拖拽过程：按住某列手柄，整组列同步变宽；松手回调 onCommit
function startResize(e, th, cols, widths, group, onCommit, onResized, min, max) {
  e.preventDefault();
  const ci = +th.dataset.col;
  const g = group ? group(ci) : ci;
  const same = (i) => (group ? group(i) : i) === g;
  const startX = e.clientX;
  const starts = {};
  const targetIndexes = [];
  cols.forEach((c, i) => {
    if (!same(i)) return;
    starts[i] = parseFloat(c.style.width) || min;
    targetIndexes.push(i);
  });
  let pendingClientX = startX;
  let frameId = null;

  function applyPendingWidth() {
    frameId = null;
    const dx = pendingClientX - startX;
    targetIndexes.forEach(i => {
      const width = Math.min(max, Math.max(min, starts[i] + dx));
      cols[i].style.width = width + "px";
      widths[i] = width;
    });
    if (onResized) onResized(g);
  }
  function move(ev) {
    pendingClientX = ev.clientX;
    if (frameId == null) frameId = requestAnimationFrame(applyPendingWidth);
  }
  function up() {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
    document.body.classList.remove("col-resizing");
    // mouseup 可能发生在浏览器执行下一帧之前；先应用最后位置，确保保存值与画面一致。
    if (frameId != null) {
      cancelAnimationFrame(frameId);
      applyPendingWidth();
    }
    if (onCommit) onCommit(widths.slice());
  }
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
  document.body.classList.add("col-resizing");
}

// #endregion 表格列宽拖拽
