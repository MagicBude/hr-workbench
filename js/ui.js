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
