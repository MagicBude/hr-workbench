// ============================================================
// store.js — 数据层（负责“数据从哪来、存到哪去”）
// ------------------------------------------------------------
// 这是整个项目最关键的设计：所有读写都经过本文件。
//
// 现在：用浏览器自带的 localStorage（纯前端、离线可用，无需服务器）。
// 未来接后端：只需要把下面每个函数体改成 fetch('https://你的api/...')，
//             页面部分（roster/attendance/...）一行都不用改。
//             —— 这就是“利于长期维护、方便接后端”的核心：业务逻辑不直接碰存储细节。
//
// 对外暴露：
//   state           运行时状态（内存里的一份数据，大家共享）
//   ensureSeed()    首次启动注入示例
//   persist()       保存当前组织数据
//   reloadCurrent() 切换组织后重新加载
//   getOrgs/addOrg/setCurrentOrg/...  组织相关
// ============================================================

import { STORAGE_PREFIX } from "./config.js";

// ---------- 内存中的运行时状态（整个应用共享这一份） ----------
export const state = {
  orgs: [],      // 组织（公司）列表：[{ id, name }]
  current: null, // 当前选中的组织 id
  data: null     // 当前组织的数据：{ employees, attendance, payroll }
};

// ---------- 存储键名拼接 ----------
const KEY_ORGS = STORAGE_PREFIX + "orgs";        // 组织列表
const KEY_CURRENT = STORAGE_PREFIX + "current";  // 当前组织 id
const dataKey = (id) => STORAGE_PREFIX + id + "_data"; // 某组织的数据

// ---------- 最底层的读写小工具 ----------
// 读取并解析 JSON；出错或没有时返回 fallback（默认值）
function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch (e) { return fallback; }
}
// 写入并序列化为 JSON
function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// 返回一个"空数据"模板（新增组织时用）
export function emptyData() {
  return { employees: [], attendance: [], payroll: [] };
}

// ---------- 数据迁移：把旧版本数据升级到当前结构（向后兼容） ----------
// 设计原则："只增不减"——只给缺失的字段补默认值，绝不删除用户已有字段。
// 未来新增字段（如 holidays / settings）都加在这里，业务模块无需判断兼容性。
function migrate(data) {
  if (!data) return data;
  data.employees = (data.employees || []).map(e => ({
    restMinutes: 0,      // 可调休余额（分钟），缺省 0
    insuranceBase: null, // 社保基数，null 表示用基本月薪
    ...e                 // 展开原对象，保留已有字段（新字段仅在缺失时生效）
  }));
  return data;
}
// 对"当前内存中的数据"执行迁移（导入新 JSON 后也可调用）
export function migrateCurrent() {
  state.data = migrate(state.data);
}

// ---------- 首次启动：必要时注入示例组织与数据 ----------
// 参数 buildSample 是一个函数（来自 sample.js），避免在数据层里 import 示例数据造成循环依赖。
export function ensureSeed(buildSample) {
  state.orgs = readJSON(KEY_ORGS, []);
  state.current = localStorage.getItem(KEY_CURRENT);

  // 一个组织都没有 → 说明是第一次打开，注入“示例科技有限公司”+ 示例数据
  if (state.orgs.length === 0) {
    state.orgs = [{ id: "demo", name: "示例科技有限公司" }];
    writeJSON(KEY_ORGS, state.orgs);
    state.current = "demo";
    localStorage.setItem(KEY_CURRENT, "demo");
    writeJSON(dataKey("demo"), buildSample()); // 调用示例生成函数
  }
  // 当前组织 id 失效（比如数据被手动清过）→ 回退到第一个组织
  if (!state.current || !state.orgs.find(o => o.id === state.current)) {
    state.current = state.orgs[0].id;
    localStorage.setItem(KEY_CURRENT, state.current);
  }
  // 把当前组织的数据读进内存（并升级到最新结构）
  state.data = readJSON(dataKey(state.current), emptyData());
  migrateCurrent();
}

// 切换组织后，从存储重新加载该组织的数据到内存
export function reloadCurrent() {
  state.data = readJSON(dataKey(state.current), emptyData());
  migrateCurrent(); // 升级旧数据到新结构（向后兼容）
}

// 把内存里当前组织的数据保存回存储（任何修改后都要调用）
export function persist() {
  writeJSON(dataKey(state.current), state.data);
}

// ---------- 组织（公司）相关 ----------
export function getOrgs() { return state.orgs; }
export function getCurrentOrgId() { return state.current; }
export function getCurrentOrg() { return state.orgs.find(o => o.id === state.current); }

// 切换当前组织
export function setCurrentOrg(id) {
  state.current = id;
  localStorage.setItem(KEY_CURRENT, id);
  reloadCurrent(); // 切换后立刻把新组织的数据载入内存
}

// 新建一个组织（初始无数据）
export function addOrg(name) {
  const id = "org_" + Date.now();           // 用时间戳保证 id 唯一
  state.orgs.push({ id, name });
  writeJSON(KEY_ORGS, state.orgs);
  state.current = id;
  localStorage.setItem(KEY_CURRENT, id);
  writeJSON(dataKey(id), emptyData());
  state.data = emptyData();
}
