import test from "node:test";
import assert from "node:assert/strict";

import { countOverdrawnEmployees } from "../js/dashboard.js";

test("看板只统计余额小于零的员工", () => {
  const employees = [{ id: "positive" }, { id: "zero" }, { id: "negative-a" }, { id: "negative-b" }];
  const balances = { positive: 60, zero: 0, "negative-a": -1, "negative-b": -240 };
  assert.equal(countOverdrawnEmployees(employees, id => balances[id]), 2);
});
