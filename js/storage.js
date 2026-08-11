/*
 * storage.js — localStorage 的可靠读写边界
 *
 * 输入：存储键、普通文本或可 JSON 序列化的数据。
 * 输出：读取结果；失败时统一抛出带 kind 的 StorageError。
 * 协作：store.js 只通过本模块访问 localStorage，main.js 根据错误类别提示用户。
 *
 * 约束：损坏 JSON 不能静默当成空数据，否则后续保存会覆盖仍可人工恢复的原文。
 */

// #region 错误分类

export class StorageError extends Error {
  constructor(kind, key, cause) {
    super(storageErrorMessage(kind), { cause });
    this.name = "StorageError";
    this.kind = kind;
    this.key = key;
  }
}

export function storageErrorMessage(kind) {
  const messages = {
    unavailable: "浏览器本地存储不可用，请检查隐私模式或站点权限。",
    quota: "本地存储空间不足，请先导出备份或清理旧快照。",
    corrupt: "检测到损坏的本地数据，系统已停止加载以避免覆盖原内容。",
    serialize: "数据无法序列化，修改尚未保存。",
    unknown: "本地数据操作失败，修改可能尚未保存。"
  };
  return messages[kind] || messages.unknown;
}

function writeErrorKind(error) {
  if (error?.name === "QuotaExceededError" || error?.code === 22 || error?.code === 1014) {
    return "quota";
  }
  return "unavailable";
}

// #endregion 错误分类

// #region 文本与 JSON 读写

export function readText(key, fallback = null) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch (error) {
    throw new StorageError("unavailable", key, error);
  }
}

export function writeText(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    throw new StorageError(writeErrorKind(error), key, error);
  }
}

export function removeStoredValue(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    throw new StorageError("unavailable", key, error);
  }
}

export function readJSON(key, fallback) {
  const text = readText(key);
  if (text == null) return fallback;

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new StorageError("corrupt", key, error);
  }
}

export function writeJSON(key, value) {
  let text;
  try {
    text = JSON.stringify(value);
  } catch (error) {
    throw new StorageError("serialize", key, error);
  }
  writeText(key, text);
}

// #endregion 文本与 JSON 读写
