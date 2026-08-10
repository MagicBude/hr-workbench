import { HALF_DAY_MINUTES, TAX_RATE, TAX_THRESHOLD, STATUS_LABEL, INSURANCE_RATIO, BIG_SICKNESS } from "./config.js";

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

export function isEmployeeActiveOn(emp, date) {
  if (!emp || emp.deletedAt) return false;
  const status = emp.employmentStatus || "active";
  if (status === "suspended") return false;
  if (emp.hireDate && date < emp.hireDate) return false;
  if (emp.leaveDate && date > emp.leaveDate) return false;
  if (status === "departed" && !emp.leaveDate) return false;
  return status === "active" || status === "probation" || status === "departed";
}

export function isEmployeeActiveInMonth(emp, month) {
  const [year, mon] = month.split("-").map(Number);
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(new Date(year, mon, 0).getDate()).padStart(2, "0")}`;
  if (!emp || emp.deletedAt || emp.employmentStatus === "suspended") return false;
  if (emp.employmentStatus === "departed" && !emp.leaveDate) return false;
  return (!emp.hireDate || emp.hireDate <= monthEnd) && (!emp.leaveDate || emp.leaveDate >= monthStart);
}

export function isWorkdayDate(date, holidays = {}) {
  const override = holidays[date];
  if (override) return override.type === "workday";
  const day = new Date(`${date}T12:00:00`).getDay();
  return day !== 0 && day !== 6;
}

function statusOf(value) {
  return value && typeof value === "object" ? value.s : value;
}
function minutesOf(value, fallback) {
  return value && typeof value === "object" && value.min != null ? Math.max(0, Math.min(fallback, Number(value.min) || 0)) : fallback;
}

export function attendanceMetrics(emp, month, attendance, holidays = {}, halfDayMinutes = HALF_DAY_MINUTES, asOf = "") {
  const [year, mon] = month.split("-").map(Number);
  let days = new Date(year, mon, 0).getDate();
  if (asOf && asOf.slice(0, 7) === month) days = Math.min(days, Number(asOf.slice(8, 10)) || days);
  const rec = attendance?.rec || {};
  const result = { expectedMinutes: 0, actualMinutes: 0, leaveMinutes: 0, absentMinutes: 0, missingMinutes: 0, lateCount: 0, earlyCount: 0 };
  for (let day = 1; day <= days; day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    if (!isWorkdayDate(date, holidays) || !isEmployeeActiveOn(emp, date)) continue;
    result.expectedMinutes += halfDayMinutes * 2;
    const cell = rec[day] || rec[String(day)] || {};
    for (const shift of ["am", "pm"]) {
      const value = cell?.[shift];
      const status = statusOf(value);
      if (status === "√" || status === "迟" || status === "退") result.actualMinutes += halfDayMinutes;
      else if (status === "事" || status === "病" || status === "调" || status === "年") {
        const minutes = minutesOf(value, halfDayMinutes); result.leaveMinutes += minutes; result.actualMinutes += halfDayMinutes - minutes;
      } else if (status === "缺") {
        const minutes = minutesOf(value, halfDayMinutes); result.absentMinutes += minutes; result.actualMinutes += halfDayMinutes - minutes;
      }
      else result.missingMinutes += halfDayMinutes;
      if (status === "迟") result.lateCount += 1;
      if (status === "退") result.earlyCount += 1;
    }
  }
  result.rate = result.expectedMinutes ? Math.round(result.actualMinutes / result.expectedMinutes * 100) : 0;
  return result;
}

export function estimateTax(gross, personalTotal, threshold = TAX_THRESHOLD, rate = TAX_RATE) {
  return Math.max(0, Number(gross || 0) - Number(personalTotal || 0) - threshold) * rate;
}

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

export function buildPayrollRecord(month, empId, baseSalary, travel = 0, bonus = 0, overtime = 0) {
  const company = INSURANCE_RATIO.company;
  const personal = INSURANCE_RATIO.personal;
  const comp = {
    养老: baseSalary * company.养老, 医疗: baseSalary * company.医疗, 工伤: baseSalary * company.工伤,
    失业: baseSalary * company.失业, 生育: baseSalary * company.生育, 公积金: baseSalary * company.公积金
  };
  const pers = {
    养老: baseSalary * personal.养老, 医疗: baseSalary * personal.医疗, 失业: baseSalary * personal.失业,
    公积金: baseSalary * personal.公积金, 大病医疗: BIG_SICKNESS
  };
  const gross = baseSalary + travel + bonus + overtime;
  const persTotal = Object.values(pers).reduce((sum, value) => sum + value, 0);
  const tax = estimateTax(gross, persTotal);
  return {
    id: `p_${month}_${empId}`, month, empId, baseSalary, travel, bonus, overtime,
    comp, pers, gross, persTotal, tax, taxManual: false, status: "draft", net: gross - persTotal - tax
  };
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
}

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
    if (emp.employmentStatus != null && !Object.hasOwn(EMPLOYMENT_STATUS, emp.employmentStatus)) throw new Error(`employees[${index}].employmentStatus 无效`);
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
