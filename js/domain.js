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

import { HALF_DAY_MINUTES, TAX_RATE, TAX_THRESHOLD, STATUS_LABEL, INSURANCE_RATIO, BIG_SICKNESS } from "./config.js";

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
  const result = {
    expectedMinutes: 0,
    actualMinutes: 0,
    leaveMinutes: 0,
    absentMinutes: 0,
    missingMinutes: 0,
    lateCount: 0,
    earlyCount: 0
  };
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

/*
 * 导入数据进入迁移和 localStorage 之前的第一道结构校验。
 * 当前校验仍是渐进式实现，完整字段、范围、引用关系和资源上限见审查计划。
 * 校验失败时调用方不得改变当前组织或现有数据。
 */
export function validateImportPayload(input) {
  const data = input?.data || input;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("导入文件不是有效的数据对象");
  for (const key of ["employees", "attendance", "payroll"]) {
    if (data[key] != null && !Array.isArray(data[key])) throw new Error(`${key} 必须是数组`);
  }
  (data.employees || []).forEach((emp, index) => {
    if (!emp || typeof emp !== "object") throw new Error(`employees[${index}] 格式无效`);
    for (const key of ["id", "name", "dept"]) {
      if (emp[key] != null && typeof emp[key] !== "string") throw new Error(`employees[${index}].${key} 必须是文本`);
      if (String(emp[key] || "").length > 100) throw new Error(`employees[${index}].${key} 过长`);
    }
    if (emp.employmentStatus != null && !Object.hasOwn(EMPLOYMENT_STATUS, emp.employmentStatus)) {
      throw new Error(`employees[${index}].employmentStatus 无效`);
    }
  });
  for (const key of ["attendance", "payroll"]) {
    (data[key] || []).forEach((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${key}[${index}] 格式无效`);
      if (item.id != null && (typeof item.id !== "string" || item.id.length > 120)) throw new Error(`${key}[${index}].id 无效`);
      if (item.empId != null && (typeof item.empId !== "string" || item.empId.length > 120)) throw new Error(`${key}[${index}].empId 无效`);
    });
  }
  const employeeIds = (data.employees || []).map(emp => emp.id).filter(Boolean);
  if (new Set(employeeIds).size !== employeeIds.length) throw new Error("employees 存在重复 id");
  return data;
}

// #endregion 不可信输入与导入校验
