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

import { STORAGE_PREFIX, SCHEMA_VERSION, HOLIDAYS_2026, DEFAULT_SETTINGS, INSURANCE_RATIO, BIG_SICKNESS, HALF_DAY_MINUTES } from "./config.js";
import { validateImportPayload } from "./domain.js";
import { sumRec } from "./sample.js";

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
const snapshotKey = (id) => STORAGE_PREFIX + id + "_snapshots";
const preferenceKey = (name) => STORAGE_PREFIX + state.current + "_pref_" + name;

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
  return {
    schemaVersion: SCHEMA_VERSION,
    employees: [], attendance: [], payroll: [],
    settings: { ...DEFAULT_SETTINGS, departments: [], insuranceRatio: JSON.parse(JSON.stringify(INSURANCE_RATIO)), bigSickness: BIG_SICKNESS }
  };
}

// ---------- 数据迁移：把旧版本数据升级到当前结构（向后兼容） ----------
// 设计原则："只增不减"——只给缺失的字段补默认值，绝不删除用户已有字段。
// 未来新增字段（如 holidays / settings）都加在这里，业务模块无需判断兼容性。
function migrate(data) {
  if (!data) return data;
  // 1) 员工补新字段
  data.employees = (data.employees || []).map(e => ({
    employmentStatus: "active",
    leaveDate: "",
    deletedAt: null,
    restMinutes: 0,      // 兼容旧字段（新逻辑改用 restSeedMinutes + 动态计算）
    restSeedMinutes: (e.restSeedMinutes != null) ? e.restSeedMinutes : (e.restMinutes || 0), // 初始可调休余额（分钟）
    insuranceBase: null, // 社保基数，null 表示用基本月薪
    ...e                 // 展开原对象，保留已有字段（新字段仅在缺失时生效）
  }));
  data.payroll = (data.payroll || []).map(p => ({ status: "draft", taxManual: false, ...p }));
  data.schemaVersion = SCHEMA_VERSION;
  // 2) 考勤旧结构升级：{day:"√"} → {day:{am:"√",pm:"√",ot:""}}（上午/下午沿用旧值，加班留空）
  data.attendance = (data.attendance || []).map(a => {
    const rec = {};
    for (const day in (a.rec || {})) {
      const v = a.rec[day];
      rec[day] = (v && typeof v === "object") ? v : { am: v || "", pm: v || "", ot: "" };
    }
    return { ...a, rec, summary: sumRec(rec) };
  });
  // 3) 节假日：缺省用 2026 国家法定节假日
  if (!data.holidays) data.holidays = { ...HOLIDAYS_2026 };
  // 4) 组织设置：缺省用默认值（加班转调休开关、半天分钟数等）
  data.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
  // 5) 社保比例 / 大病医疗：缺省用全局默认（Phase 3 可在"比例设置"里改）
  if (!data.settings.insuranceRatio) data.settings.insuranceRatio = JSON.parse(JSON.stringify(INSURANCE_RATIO));
  if (data.settings.bigSickness == null) data.settings.bigSickness = BIG_SICKNESS;
  // 6) 部门列表：缺省从现有员工的部门汇总（去重），避免手输拼出幽灵部门
  if (!Array.isArray(data.settings.departments)) {
    const set = new Set();
    (data.employees || []).forEach(e => { if (e.dept) set.add(e.dept); });
    data.settings.departments = [...set];
  }
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

export function loadPreference(name, fallback = null) { return readJSON(preferenceKey(name), fallback); }
export function savePreference(name, value) { writeJSON(preferenceKey(name), value); }
export function removePreference(name) { localStorage.removeItem(preferenceKey(name)); }

export function createSnapshot(reason = "手动快照") {
  const snapshots = readJSON(snapshotKey(state.current), []);
  snapshots.unshift({ id: `snap_${Date.now()}`, createdAt: new Date().toISOString(), reason, data: structuredClone(state.data) });
  writeJSON(snapshotKey(state.current), snapshots.slice(0, 10));
  return snapshots[0];
}
export function listSnapshots() { return readJSON(snapshotKey(state.current), []); }
export function restoreSnapshot(id) {
  const item = listSnapshots().find(x => x.id === id);
  if (!item) throw new Error("快照不存在或已被清理");
  createSnapshot("恢复快照前自动备份");
  state.data = migrate(structuredClone(item.data));
  persist();
}
export function getStorageUsage() {
  let bytes = 0;
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_PREFIX)) bytes += (key.length + (localStorage.getItem(key) || "").length) * 2;
  }
  return bytes;
}
export function prepareImportedData(input) { return migrate(structuredClone(validateImportPayload(input))); }

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
export function selectImportedOrg(org) {
  if (!state.orgs.some(o => o.id === org.id)) {
    state.orgs.push({ id: org.id, name: org.name || org.id });
    writeJSON(KEY_ORGS, state.orgs);
  }
  state.current = org.id;
  localStorage.setItem(KEY_CURRENT, org.id);
}

// ---------- 部门（组织级选项） ----------
// 返回当前组织的部门列表（数组），新增/编辑员工时作为下拉选项
export function getDepartments() { return state.data.settings.departments || []; }
// 新增一个部门（已存在则忽略），立即保存
export function addDepartment(name) {
  const n = (name || "").trim();
  if (!n) return;
  const list = state.data.settings.departments || (state.data.settings.departments = []);
  if (!list.includes(n)) { list.push(n); persist(); }
}

// ---------- 可调休余额（动态计算，分钟级） ----------
// 可用余额 = 初始余额(restSeedMinutes) + 加班累计(分钟) − 调休累计(分钟)。
// 每次考勤变动后无需手动维护计数器，按记录实时算，不会漂移。
export function computeRestMinutes(empId) {
  const st = (state.data && state.data.settings) || {};
  const half = st.halfDayMinutes || HALF_DAY_MINUTES; // 整段请假默认按半天(240 分钟)计
  const otDefault = 60;                                // 加班未设时长时默认 1 小时
  const ratio = st.overtimeToRestRatio ?? 1;
  let used = 0, earned = 0;
  const atts = (state.data && state.data.attendance) || [];
  for (const a of atts) {
    if (a.empId !== empId) continue;
    const rec = a.rec || {};
    for (const day in rec) {
      const cell = rec[day];
      if (!cell) continue;
      ["am", "pm", "ot"].forEach(sh => {
        const v = cell[sh];
        if (!v) return;
        const s = (typeof v === "object") ? v.s : v;
        if (s === "调" && sh !== "ot") {
          const m = (typeof v === "object" && v.min != null) ? v.min : half;
          used += m;
        }
        if (s === "加" && st.overtimeToRest) {
          const m = (typeof v === "object" && v.min != null) ? v.min : otDefault;
          earned += m * ratio;
        }
      });
    }
  }
  const emp = (state.data && state.data.employees || []).find(x => x.id === empId);
  const seed = (emp && emp.restSeedMinutes) || 0;
  return Math.round(seed + earned - used);
}
