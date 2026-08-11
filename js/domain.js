/*
 * domain.js — HR Workbench 的纯业务规则层
 *
 * 输入：员工、考勤、薪资和导入包等普通 JavaScript 对象。
 * 输出：统计结果、初始薪资记录、校验后的导入数据或可读的校验错误。
 * 协作：页面模块和 store.js 调用这里的规则，tests/domain.test.js 直接测试同一份实现。
 *
 * 关键约束：本文件不访问 DOM、localStorage 或浏览器弹窗。业务口径只有保持为纯函数，
 * 才能被看板、导出和页面共同复用，并在 Node 环境中可靠测试。
 */

import { HALF_DAY_MINUTES, TAX_RATE, TAX_THRESHOLD, STATUS_LABEL, STATUSES, INSURANCE_RATIO, BIG_SICKNESS } from "./config.js";

// #region 员工生命周期

export const EMPLOYMENT_STATUS = {
  probation: "试用",
  active: "在职",
  suspended: "停薪",
  departed: "离职"
};

export const PAYROLL_STATUS = {
  draft: "草稿",
  confirmed: "已确认",
  paid: "已发放"
};

// 薪资状态只允许沿核算流程前进；已锁定记录若要修改，必须显式解锁回草稿。
// 不允许“草稿直接已发放”或“已发放退回已确认”，避免绕过确认和解锁动作。
const PAYROLL_STATUS_TRANSITIONS = {
  draft: ["draft", "confirmed"],
  confirmed: ["draft", "confirmed", "paid"],
  paid: ["draft", "paid"]
};

export function canTransitionPayrollStatus(currentStatus, nextStatus) {
  const current = Object.hasOwn(PAYROLL_STATUS_TRANSITIONS, currentStatus) ? currentStatus : "draft";
  return PAYROLL_STATUS_TRANSITIONS[current].includes(nextStatus);
}

// 判断员工在某个自然日是否应参与考勤。入职日和离职日都包含在任职区间内，
// 因此只有 date 严格早于入职日或晚于离职日时才排除。
export function isEmployeeActiveOn(employee, date) {
  if (!employee || employee.deletedAt) return false;
  const status = employee.employmentStatus || "active";
  if (status === "suspended") return false;
  if (employee.hireDate && date < employee.hireDate) return false;
  if (employee.leaveDate && date > employee.leaveDate) return false;
  if (status === "departed" && !employee.leaveDate) return false;
  return status === "active" || status === "probation" || status === "departed";
}

// 月度列表只关心任职区间是否与该月有交集，不能只看月末状态。
// 例如员工月中入职又在月末前离职，仍然属于该月的有效员工。
export function isEmployeeActiveInMonth(employee, month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(new Date(year, monthNumber, 0).getDate()).padStart(2, "0")}`;
  if (!employee || employee.deletedAt || employee.employmentStatus === "suspended") return false;
  if (employee.employmentStatus === "departed" && !employee.leaveDate) return false;
  return (!employee.hireDate || employee.hireDate <= monthEnd)
    && (!employee.leaveDate || employee.leaveDate >= monthStart);
}

// #endregion 员工生命周期

// #region 工作日与考勤统计

// 节假日人工覆盖的优先级高于普通周末规则：周末可以被标为调休上班日，
// 工作日也可以被标为组织额外假期。中午 12 点构造 Date 可减少时区边界干扰。
export function isWorkdayDate(date, holidays = {}) {
  const override = holidays[date];
  if (override) return override.type === "workday";
  const day = new Date(`${date}T12:00:00`).getDay();
  return day !== 0 && day !== 6;
}

// 考勤值兼容两种结构：旧数据是单字符，新数据是 { s, min }。
function statusOf(value) {
  return value && typeof value === "object" ? value.s : value;
}
// 自定义分钟数只允许落在 0 到当前时段标准分钟数之间，避免异常导入制造负工时。
function minutesOf(value, fallback) {
  if (!value || typeof value !== "object" || value.min == null) return fallback;
  const minutes = Number(value.min) || 0;
  return Math.max(0, Math.min(fallback, minutes));
}

/*
 * 计算单个员工某月的工时口径。
 * expectedMinutes 是有效任职区间内的应出勤分钟；actualMinutes 是实际完成分钟。
 * 请假、缺勤和未录入单列，供看板解释出勤率。迟到/早退计异常但仍计该时段出勤。
 * 当前月传入 asOf 后只统计截止日，避免把未来日期误判为未录入。
 */
export function attendanceMetrics(employee, month, attendanceRecord, holidays = {}, halfDayMinutes = HALF_DAY_MINUTES, asOf = "") {
  const [year, monthNumber] = month.split("-").map(Number);
  let days = new Date(year, monthNumber, 0).getDate();
  if (asOf && asOf.slice(0, 7) === month) {
    days = Math.min(days, Number(asOf.slice(8, 10)) || days);
  }
  const dailyRecords = attendanceRecord?.rec || {};
  const result = { expectedMinutes: 0, actualMinutes: 0, leaveMinutes: 0, absentMinutes: 0, missingMinutes: 0, lateCount: 0, earlyCount: 0 };
  for (let day = 1; day <= days; day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    if (!isWorkdayDate(date, holidays) || !isEmployeeActiveOn(employee, date)) continue;
    result.expectedMinutes += halfDayMinutes * 2;
    const cell = dailyRecords[day] || dailyRecords[String(day)] || {};
    for (const shift of ["am", "pm"]) {
      const value = cell?.[shift];
      const status = statusOf(value);
      if (status === "√" || status === "迟" || status === "退") {
        result.actualMinutes += halfDayMinutes;
      } else if (status === "事" || status === "病" || status === "调" || status === "年") {
        const minutes = minutesOf(value, halfDayMinutes);
        result.leaveMinutes += minutes;
        result.actualMinutes += halfDayMinutes - minutes;
      } else if (status === "缺") {
        const minutes = minutesOf(value, halfDayMinutes);
        result.absentMinutes += minutes;
        result.actualMinutes += halfDayMinutes - minutes;
      } else {
        result.missingMinutes += halfDayMinutes;
      }
      if (status === "迟") result.lateCount += 1;
      if (status === "退") result.earlyCount += 1;
    }
  }
  result.rate = result.expectedMinutes ? Math.round(result.actualMinutes / result.expectedMinutes * 100) : 0;
  return result;
}

// #endregion 工作日与考勤统计

// #region 薪资计算

// 当前税额是演示用月度估算，不是中国个税累计预扣算法。
export function estimateTax(gross, personalTotal, threshold = TAX_THRESHOLD, rate = TAX_RATE) {
  return Math.max(0, Number(gross || 0) - Number(personalTotal || 0) - threshold) * rate;
}

// min="0" 只是浏览器输入提示，脚本赋值和旧数据仍可绕过，因此保存和计算层
// 都必须执行同一校验。空字符串是否允许由调用方在调用前决定。
export function requireNonNegativeNumber(value, label = "金额") {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label}必须是大于或等于 0 的有限数字`);
  return number;
}

// 上午和下午每格各计 0.5 天；加班位于独立 ot 时段，按次数统计。
export function summarizeAttendance(rec = {}) {
  const summary = { 出勤: 0, 事假: 0, 病假: 0, 缺勤: 0, 调休: 0, 年假: 0, 加班: 0, 迟到: 0, 早退: 0 };
  for (const day of Object.values(rec)) {
    if (day && typeof day === "object") {
      for (const shift of ["am", "pm"]) {
        const status = statusOf(day[shift]);
        if (status === "√") summary.出勤 += 0.5;
        else if (STATUS_LABEL[status]) summary[STATUS_LABEL[status]] += 0.5;
      }
      if (statusOf(day.ot) === "加") summary.加班 += 1;
    } else if (day === "√") summary.出勤 += 1;
    else if (STATUS_LABEL[day]) summary[STATUS_LABEL[day]] += 1;
  }
  return summary;
}

// 创建薪资草稿的唯一入口，避免页面与导出采用不同的初始核算口径。
export function buildPayrollRecord(month, empId, baseSalary, travel = 0, bonus = 0, overtime = 0) {
  const company = INSURANCE_RATIO.company;
  const personal = INSURANCE_RATIO.personal;
  const companyContributions = {
    养老: baseSalary * company.养老, 医疗: baseSalary * company.医疗, 工伤: baseSalary * company.工伤,
    失业: baseSalary * company.失业, 生育: baseSalary * company.生育, 公积金: baseSalary * company.公积金
  };
  const personalContributions = {
    养老: baseSalary * personal.养老, 医疗: baseSalary * personal.医疗, 失业: baseSalary * personal.失业,
    公积金: baseSalary * personal.公积金, 大病医疗: BIG_SICKNESS
  };
  const gross = baseSalary + travel + bonus + overtime;
  const personalTotal = Object.values(personalContributions).reduce((sum, value) => sum + value, 0);
  const tax = estimateTax(gross, personalTotal);
  return {
    id: `p_${month}_${empId}`, month, empId, baseSalary, travel, bonus, overtime,
    comp: companyContributions,
    pers: personalContributions,
    gross,
    persTotal: personalTotal,
    tax,
    taxManual: false,
    status: "draft",
    net: gross - personalTotal - tax
  };
}

// #endregion 薪资计算

// #region 不可信输入与导入校验

// 仅用于 HTML 文本和普通属性值的基础转义；更安全的选择仍是 textContent/value。
export function escapeHtml(value) {
  const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" };
  return String(value ?? "").replace(/[&<>'"]/g, character => entities[character]);
}

export const IMPORT_LIMITS = {
  fileBytes: 5 * 1024 * 1024,
  employees: 5000,
  attendance: 60000,
  payroll: 60000,
  text: 100,
  id: 120
};

function importError(path, message) {
  throw new Error(`${path} ${message}`);
}

function objectAt(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) importError(path, "必须是对象");
  return value;
}

function textAt(value, path, { required = false, max = IMPORT_LIMITS.text } = {}) {
  if (value == null || value === "") {
    if (required) importError(path, "不能为空");
    return;
  }
  if (typeof value !== "string") importError(path, "必须是文本");
  if (value.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) {
    importError(path, "包含非法字符或过长");
  }
}

function finiteNumberAt(value, path, { min = 0, max = 1e9 } = {}) {
  if (value == null) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    importError(path, `必须是 ${min}～${max} 的有限数字`);
  }
}

function dateAt(value, path) {
  if (value == null || value === "") return;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) importError(path, "日期格式无效");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    importError(path, "日期不存在");
  }
}

function monthAt(value, path) {
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) importError(path, "月份格式无效");
}

function statusValueAt(value, path) {
  if (value == null || value === "") return;
  const status = typeof value === "object" && !Array.isArray(value) ? value.s : value;
  if (!STATUSES.includes(status)) importError(path, "考勤状态无效");
  if (typeof value === "object") finiteNumberAt(value.min, `${path}.min`, { min: 0, max: 1440 });
}

function validateSettings(settings) {
  if (settings == null) return;
  objectAt(settings, "settings");
  finiteNumberAt(settings.halfDayMinutes, "settings.halfDayMinutes", { min: 30, max: 720 });
  finiteNumberAt(settings.overtimeToRestRatio, "settings.overtimeToRestRatio", { min: 0, max: 5 });
  finiteNumberAt(settings.bigSickness, "settings.bigSickness");
  for (const key of ["overtimeToRest", "enableLateEarly", "enforceRestBalance", "showTodayTodos", "compactTables"]) {
    if (settings[key] != null && typeof settings[key] !== "boolean") importError(`settings.${key}`, "必须是布尔值");
  }
  if (settings.defaultMonth) monthAt(settings.defaultMonth, "settings.defaultMonth");
  if (settings.departments != null) {
    if (!Array.isArray(settings.departments) || settings.departments.length > 500) importError("settings.departments", "无效");
    settings.departments.forEach((department, index) => textAt(department, `settings.departments[${index}]`, { required: true }));
  }
  for (const group of ["company", "personal"]) {
    const ratios = settings.insuranceRatio?.[group];
    if (ratios == null) continue;
    objectAt(ratios, `settings.insuranceRatio.${group}`);
    Object.entries(ratios).forEach(([key, value]) => {
      textAt(key, `settings.insuranceRatio.${group} 键`, { required: true });
      finiteNumberAt(value, `settings.insuranceRatio.${group}.${key}`, { min: 0, max: 1 });
    });
  }
}

function validateHolidays(holidays) {
  if (holidays == null) return;
  objectAt(holidays, "holidays");
  const entries = Object.entries(holidays);
  if (entries.length > 5000) importError("holidays", "超过 5000 条限制");
  entries.forEach(([date, holiday]) => {
    dateAt(date, `holidays.${date}`);
    objectAt(holiday, `holidays.${date}`);
    textAt(holiday.name, `holidays.${date}.name`, { required: true });
    if (!["holiday", "workday"].includes(holiday.type)) importError(`holidays.${date}.type`, "无效");
  });
}

/* 导入校验必须在创建组织、切换组织和写入存储之前全部完成。 */
export function validateImportPayload(input) {
  const data = input?.data || input;
  objectAt(data, "data");

  if (input?.org != null) {
    objectAt(input.org, "org");
    textAt(input.org.id, "org.id", { required: true, max: 80 });
    if (!/^[A-Za-z0-9_-]+$/.test(input.org.id)) importError("org.id", "只能包含字母、数字、下划线和连字符");
    textAt(input.org.name, "org.name", { max: 100 });
  }

  const collections = [["employees", IMPORT_LIMITS.employees], ["attendance", IMPORT_LIMITS.attendance], ["payroll", IMPORT_LIMITS.payroll]];
  for (const [key, limit] of collections) {
    if (!Array.isArray(data[key])) importError(key, "必须是数组");
    if (data[key].length > limit) importError(key, `超过 ${limit} 条限制`);
  }

  (data.employees || []).forEach((emp, index) => {
    const path = `employees[${index}]`;
    objectAt(emp, path);
    textAt(emp.id, `${path}.id`, { required: true, max: IMPORT_LIMITS.id });
    textAt(emp.name, `${path}.name`, { required: true });
    textAt(emp.dept, `${path}.dept`);
    dateAt(emp.hireDate, `${path}.hireDate`);
    dateAt(emp.leaveDate, `${path}.leaveDate`);
    if (emp.hireDate && emp.leaveDate && emp.leaveDate < emp.hireDate) importError(path, "离职日期不能早于入职日期");
    finiteNumberAt(emp.baseSalary, `${path}.baseSalary`);
    finiteNumberAt(emp.restSeedMinutes, `${path}.restSeedMinutes`);
    finiteNumberAt(emp.insuranceBase, `${path}.insuranceBase`);
    if (emp.employmentStatus != null && !Object.hasOwn(EMPLOYMENT_STATUS, emp.employmentStatus)) importError(`${path}.employmentStatus`, "无效");
  });

  const employeeIds = data.employees.map(emp => emp.id);
  if (new Set(employeeIds).size !== employeeIds.length) throw new Error("employees 存在重复 id");
  const employeeIdSet = new Set(employeeIds);

  const attendanceKeys = new Set();
  data.attendance.forEach((attendance, index) => {
    const path = `attendance[${index}]`;
    objectAt(attendance, path);
    textAt(attendance.id, `${path}.id`, { max: IMPORT_LIMITS.id });
    textAt(attendance.empId, `${path}.empId`, { required: true, max: IMPORT_LIMITS.id });
    monthAt(attendance.month, `${path}.month`);
    if (!employeeIdSet.has(attendance.empId)) importError(`${path}.empId`, "引用了不存在的员工");
    const businessKey = `${attendance.month}\0${attendance.empId}`;
    if (attendanceKeys.has(businessKey)) importError(path, "存在重复月份和员工记录");
    attendanceKeys.add(businessKey);
    objectAt(attendance.rec || {}, `${path}.rec`);
    Object.entries(attendance.rec || {}).forEach(([day, cell]) => {
      if (!/^(?:[1-9]|[12]\d|3[01])$/.test(day)) importError(`${path}.rec.${day}`, "日期键无效");
      if (cell && typeof cell === "object" && !Array.isArray(cell)) {
        for (const shift of ["am", "pm", "ot"]) statusValueAt(cell[shift], `${path}.rec.${day}.${shift}`);
      } else {
        statusValueAt(cell, `${path}.rec.${day}`); // 兼容迁移前的旧结构
      }
    });
  });

  const payrollKeys = new Set();
  data.payroll.forEach((payroll, index) => {
    const path = `payroll[${index}]`;
    objectAt(payroll, path);
    textAt(payroll.id, `${path}.id`, { max: IMPORT_LIMITS.id });
    textAt(payroll.empId, `${path}.empId`, { required: true, max: IMPORT_LIMITS.id });
    monthAt(payroll.month, `${path}.month`);
    if (!employeeIdSet.has(payroll.empId)) importError(`${path}.empId`, "引用了不存在的员工");
    const businessKey = `${payroll.month}\0${payroll.empId}`;
    if (payrollKeys.has(businessKey)) importError(path, "存在重复月份和员工记录");
    payrollKeys.add(businessKey);
    for (const key of ["baseSalary", "travel", "bonus", "overtime", "gross", "persTotal", "tax", "net"]) {
      finiteNumberAt(payroll[key], `${path}.${key}`);
    }
    for (const group of ["comp", "pers"]) {
      if (payroll[group] == null) continue;
      objectAt(payroll[group], `${path}.${group}`);
      Object.entries(payroll[group]).forEach(([key, value]) => {
        textAt(key, `${path}.${group} 键`, { required: true });
        finiteNumberAt(value, `${path}.${group}.${key}`);
      });
    }
    if (payroll.status != null && !Object.hasOwn(PAYROLL_STATUS, payroll.status)) importError(`${path}.status`, "无效");
  });

  validateSettings(data.settings);
  validateHolidays(data.holidays);
  return data;
}

// #endregion 不可信输入与导入校验
