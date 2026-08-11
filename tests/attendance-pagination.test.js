import test from "node:test";
import assert from "node:assert/strict";

import { paginateAttendance } from "../js/attendance.js";

const employees = Array.from({ length: 120 }, (_, index) => ({ id: `e${index + 1}` }));

test("考勤分页返回指定页及全局范围", () => {
  const result = paginateAttendance(employees, 3, 50);

  assert.equal(result.page, 3);
  assert.equal(result.totalPages, 3);
  assert.equal(result.start, 101);
  assert.equal(result.end, 120);
  assert.deepEqual(result.items.map(item => item.id), employees.slice(100).map(item => item.id));
});

test("考勤页码超出范围时自动夹紧", () => {
  assert.equal(paginateAttendance(employees, 99, 50).page, 3);
  assert.equal(paginateAttendance(employees, -2, 50).page, 1);
});

test("考勤分页只接受约定的每页人数", () => {
  assert.equal(paginateAttendance(employees, 1, 25).pageSize, 25);
  assert.equal(paginateAttendance(employees, 1, 100).pageSize, 100);
  assert.equal(paginateAttendance(employees, 1, 12).pageSize, 50);
});

test("空筛选结果仍保留稳定的第一页状态", () => {
  const result = paginateAttendance([], 5, 50);

  assert.equal(result.page, 1);
  assert.equal(result.totalPages, 1);
  assert.equal(result.start, 0);
  assert.equal(result.end, 0);
  assert.deepEqual(result.items, []);
});
