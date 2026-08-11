/*
 * diagnostics.js — 隐私友好的本地诊断日志
 *
 * 输入：错误对象和不含业务数据的模块/操作上下文。
 * 输出：仅存在当前页面内存中的最近 50 条结构化记录，可由用户主动导出。
 * 约束：不得记录错误 message、stack、姓名、金额、考勤详情、存储键或导入内容。
 */

const MAX_ENTRIES = 50;
const entries = [];

function safeLabel(value, fallback) {
  const text = String(value || fallback).replace(/[^A-Za-z0-9_-]/g, "_");
  return text.slice(0, 40) || fallback;
}

export function reportError(error, context = {}) {
  const entry = {
    time: new Date().toISOString(),
    module: safeLabel(context.module, "unknown"),
    operation: safeLabel(context.operation, "unknown"),
    category: safeLabel(error?.kind || error?.name, "Error")
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  return entry;
}

export function getDiagnostics() {
  return {
    generatedAt: new Date().toISOString(),
    entryCount: entries.length,
    entries: structuredClone(entries)
  };
}

export function clearDiagnostics() {
  entries.length = 0;
}
