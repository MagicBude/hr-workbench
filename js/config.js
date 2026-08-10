// ============================================================
// config.js — 全局配置与常量
// ------------------------------------------------------------
// 作用：集中存放“所有模块都会用到”的常量，比如考勤状态种类、
//       颜色、五险一金比例。把所有“固定值”放一处，以后想改比例或
//       增加一种考勤状态，只改这个文件即可，不用满世界找。
// 这是“利于长期维护”的基本功：避免把数字散落在代码各处（俗称魔法数字）。
// ============================================================

// 存储键前缀：localStorage 里所有键都以 wb_hr_ 开头，避免和其他网站冲突
export const STORAGE_PREFIX = "wb_hr_";

// 考勤的 9 种状态（含新增的迟到/早退）。点击日期格时，就在这 9 个里循环切换。
export const STATUSES = ["√", "事", "病", "缺", "调", "年", "加", "迟", "退"];

// 每种状态的中文名（用于“汇总”列展示，例如 出勤/事假）
export const STATUS_LABEL = {
  "√": "出勤", "事": "事假", "病": "病假", "缺": "缺勤",
  "调": "调休", "年": "年假", "加": "加班", "迟": "迟到", "退": "早退"
};

// 每种状态的显示颜色（背景色 bg + 文字色 fg），让表格一眼能区分
export const STATUS_COLOR = {
  "√": { bg: "#e8f5e9", fg: "#1b5e20" }, // 出勤：绿
  "事": { bg: "#fff3e0", fg: "#e65100" }, // 事假：橙
  "病": { bg: "#e3f2fd", fg: "#0d47a1" }, // 病假：蓝
  "缺": { bg: "#fce4ec", fg: "#b71c1c" }, // 缺勤：红
  "调": { bg: "#f3e5f5", fg: "#4a148c" }, // 调休：紫
  "年": { bg: "#e0f7fa", fg: "#006064" }, // 年假：青
  "加": { bg: "#fffde7", fg: "#f57f17" }, // 加班：黄
  "迟": { bg: "#ffebee", fg: "#c62828" }, // 迟到：红
  "退": { bg: "#e8eaf6", fg: "#283593" }  // 早退：蓝紫
};

// 汇总列顺序（与考勤表头一致）；迟到/早退为新增状态。
// 出勤/事假/.../迟到/早退 以“半天”为计数单位，加班以“次”计。
// 注：可调休余额的“分钟级”精度在动态计算（computeRestMinutes）里体现，不在本汇总。
export const SUM_KEYS = ["出勤", "事假", "病假", "缺勤", "调休", "年假", "加班", "迟到", "早退"];

// ---------- 考勤时段（Phase 2：一天分上午 / 下午 / 加班） ----------
export const SHIFTS = ["am", "pm", "ot"];      // am=上午 pm=下午 ot=加班
export const SHIFT_LABEL = { am: "上午", pm: "下午", ot: "加班" };
export const HALF_DAY_MINUTES = 240;           // 半天 = 240 分钟（4 小时），调休/加班换算单位

// 星期中文（数组下标 0=周日），用于考勤表头第二行
export const WEEK_LABEL = ["日", "一", "二", "三", "四", "五", "六"];

// ---------- 2026 年国家法定节假日（演示用近似值，可在界面"节假日设置"里调整） ----------
// type: "holiday"=放假（不计出勤）；"workday"=调休上班（计出勤）。
// 具体安排以国务院当年发布为准；这里内置一份合理近似值，用户可手动增删改，
// 故即使个别日期不准也不影响使用。
export const HOLIDAYS_2026 = {
  "2026-01-01": { name: "元旦", type: "holiday" },
  "2026-01-02": { name: "元旦", type: "holiday" },
  "2026-01-03": { name: "元旦", type: "holiday" },
  "2026-02-14": { name: "春节调休上班", type: "workday" },
  "2026-02-16": { name: "春节", type: "holiday" },
  "2026-02-17": { name: "春节", type: "holiday" },
  "2026-02-18": { name: "春节", type: "holiday" },
  "2026-02-19": { name: "春节", type: "holiday" },
  "2026-02-20": { name: "春节", type: "holiday" },
  "2026-02-21": { name: "春节", type: "holiday" },
  "2026-02-22": { name: "春节", type: "holiday" },
  "2026-02-28": { name: "春节调休上班", type: "workday" },
  "2026-04-04": { name: "清明节", type: "holiday" },
  "2026-04-05": { name: "清明节", type: "holiday" },
  "2026-04-06": { name: "清明节", type: "holiday" },
  "2026-05-01": { name: "劳动节", type: "holiday" },
  "2026-05-02": { name: "劳动节", type: "holiday" },
  "2026-05-03": { name: "劳动节", type: "holiday" },
  "2026-05-04": { name: "劳动节", type: "holiday" },
  "2026-05-05": { name: "劳动节", type: "holiday" },
  "2026-05-09": { name: "劳动节调休上班", type: "workday" },
  "2026-06-19": { name: "端午节", type: "holiday" },
  "2026-06-20": { name: "端午节", type: "holiday" },
  "2026-06-21": { name: "端午节", type: "holiday" },
  "2026-09-25": { name: "中秋节", type: "holiday" },
  "2026-09-26": { name: "中秋节", type: "holiday" },
  "2026-09-27": { name: "中秋节", type: "holiday" },
  "2026-10-01": { name: "国庆节", type: "holiday" },
  "2026-10-02": { name: "国庆节", type: "holiday" },
  "2026-10-03": { name: "国庆节", type: "holiday" },
  "2026-10-04": { name: "国庆节", type: "holiday" },
  "2026-10-05": { name: "国庆节", type: "holiday" },
  "2026-10-06": { name: "国庆节", type: "holiday" },
  "2026-10-07": { name: "国庆节", type: "holiday" },
  "2026-10-09": { name: "国庆节调休上班", type: "workday" }
};

// 默认组织设置（新增组织 / 旧数据迁移时注入）
export const DEFAULT_SETTINGS = {
  overtimeToRest: true,                 // 加班是否自动转为可调休
  overtimeToRestRatio: 1.0,             // 加班分钟 × 比例 = 增加的可调休分钟
  halfDayMinutes: HALF_DAY_MINUTES,     // 半天分钟数（调休扣减 / 加班增加的单位）
  departments: []                       // 部门列表（组织级选项，避免手输拼出幽灵部门）
};

// 五险一金计算比例（以“基本月薪”为基数）
// 说明：这里用的是“演示用简化值”，真实比例请以当地最新社保政策为准。
// company = 公司承担部分，personal = 个人承担部分。
export const INSURANCE_RATIO = {
  company:  { 养老: 0.16, 医疗: 0.08, 工伤: 0.002, 失业: 0.005, 生育: 0.008, 公积金: 0.12 },
  personal: { 养老: 0.08, 医疗: 0.02, 失业: 0.005, 公积金: 0.12 }
};

export const BIG_SICKNESS = 5;     // 大病医疗个人固定 5 元/月
export const TAX_THRESHOLD = 5000; // 个税起征点（每月）
export const TAX_RATE = 0.1;       // 个税简化税率（演示用，非真实累进税率）
