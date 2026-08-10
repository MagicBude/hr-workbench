// ============================================================
// export.js — Excel 导出模块（Phase 4）
// ------------------------------------------------------------
// 把花名册 / 考勤表 / 薪资表导出为 .xlsx，格式贴近原始 Excel 表格，
// 老板不打开网站也能直接查看。
// 依赖：vendor/xlsx.mini.min.js（本地 SheetJS，通过 <script> 加载为全局 XLSX）。
// 说明：本项目"零 CDN 依赖"，故 SheetJS 文件下载到本地 vendor/ 目录，
//       离线或部署 GitHub Pages 都能正常导出。
// ============================================================

import { state, computeRestMinutes } from "./store.js";
import { WEEK_LABEL, SUM_KEYS } from "./config.js";

// 该月实际天数
function daysInMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}
// 该月某日是星期几（0=周日）
function weekdayOf(month, day) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, day).getDay();
}

// ---------- 导出花名册 ----------
export function exportRosterXlsx() {
  const rows = [["序号", "姓名", "部门", "入职日期", "基本月薪", "可调休(小时)", "社保基数"]];
  state.data.employees.forEach((e, i) => {
    rows.push([i + 1, e.name, e.dept, e.hireDate || "", e.baseSalary,
      round1(computeRestMinutes(e.id) / 60), e.insuranceBase ?? ""]);
  });
  writeBook(rows, "花名册", "花名册.xlsx");
}

// ---------- 导出考勤表（表头：日期+星期；每员工三行 上/下/加；右侧汇总） ----------
export function exportAttendanceXlsx(month) {
  const N = daysInMonth(month);
  const SHIFTS3 = [["am", "上午"], ["pm", "下午"], ["ot", "加班"]];

  // 表头第 1 行：固定列 + 日期 + 汇总列名
  const head1 = ["序号", "姓名", "部门", "时段"];
  for (let d = 1; d <= N; d++) head1.push(String(d));
  head1.push(...SUM_KEYS);
  // 表头第 2 行：星期（与日期列对齐）
  const head2 = ["", "", "", ""];
  for (let d = 1; d <= N; d++) head2.push(WEEK_LABEL[weekdayOf(month, d)]);
  head2.push(...SUM_KEYS.map(() => ""));

  const rows = [head1, head2];
  state.data.employees.forEach((e, i) => {
    const a = state.data.attendance.find(x => x.month === month && x.empId === e.id);
    const rec = a ? a.rec : {};
    const s = a ? a.summary : { 出勤: 0, 事假: 0, 病假: 0, 缺勤: 0, 调休: 0, 年假: 0, 加班: 0 };
    SHIFTS3.forEach(([sh, label], si) => {
      // 只有"上午"行带 序号/姓名/部门 与汇总，其余两行留空（视觉合并效果）
      const row = si === 0 ? [i + 1, e.name, e.dept, label] : ["", "", "", label];
      for (let d = 1; d <= N; d++) {
        const cell = rec[d];
        // 新结构取对应时段；旧结构单值只放到"上午"行
        row.push(cell && typeof cell === "object" ? (cell[sh] || "") : (sh === "am" ? (cell || "") : ""));
      }
      row.push(...(si === 0 ? SUM_KEYS.map(k => s[k]) : SUM_KEYS.map(() => "")));
      rows.push(row);
    });
  });
  writeBook(rows, "考勤表_" + month, "考勤表_" + month + ".xlsx");
}

// ---------- 导出薪资表（含考勤统计 + 公司/个人缴纳分项） ----------
export function exportPayrollXlsx(month) {
  const COMP_KEYS = ["养老", "医疗", "工伤", "失业", "生育", "公积金"];
  const PERS_KEYS = ["养老", "医疗", "失业", "公积金", "大病医疗"];
  const rows = [["姓名", "部门", "入职日期", "出勤", "缺勤", "实出勤", "出差补贴", "奖金", "基本月薪", "加班费", "本月应发",
    "公司养老", "公司医疗", "公司工伤", "公司失业", "公司生育", "公司公积金",
    "个人养老", "个人医疗", "个人失业", "个人公积金", "大病医疗", "个税", "实发薪资"]];
  state.data.employees.forEach(e => {
    const p = state.data.payroll.find(x => x.month === month && x.empId === e.id);
    const a = state.data.attendance.find(x => x.month === month && x.empId === e.id);
    const s = a ? a.summary : { 出勤: 0, 缺勤: 0 };
    if (!p) {
      // 未生成薪资：只导基础信息
      rows.push([e.name, e.dept, e.hireDate || "", s.出勤, s.缺勤, s.出勤,
        0, 0, e.baseSalary, 0, e.baseSalary, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, e.baseSalary]);
      return;
    }
    const comp = p.comp || {}, pers = p.pers || {};
    rows.push([e.name, e.dept, e.hireDate || "", s.出勤, s.缺勤, s.出勤,
      p.travel, p.bonus, p.baseSalary, p.overtime, round2(p.gross),
      ...COMP_KEYS.map(k => round2(comp[k] || 0)),
      ...PERS_KEYS.map(k => round2(pers[k] || 0)),
      round2(p.tax), round2(p.net)]);
  });
  writeBook(rows, "薪资表_" + month, "薪资表_" + month + ".xlsx");
}

// ---------- 工具 ----------
function round2(n) { return Math.round((n || 0) * 100) / 100; }
function round1(n) { return Math.round((n || 0) * 10) / 10; }
// 用 SheetJS 生成并触发下载
function writeBook(aoa, sheetName, filename) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}
