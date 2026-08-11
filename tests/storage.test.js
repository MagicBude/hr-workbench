/*
 * storage.test.js — 本地存储错误边界测试
 *
 * 使用内存 mock 模拟浏览器 localStorage，覆盖缺失值、损坏 JSON、配额和序列化失败。
 * 测试结束后恢复全局对象，避免影响其他 Node 测试文件。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readJSON, writeJSON, StorageError } from "../js/storage.js";
import { STORAGE_PREFIX } from "../js/config.js";
import { state, persist, createSnapshot, listSnapshots, deleteSnapshot, clearSnapshots, computeRestMinutes, importPreparedData, addOrg, setCurrentOrg } from "../js/store.js";

function useStorageMock(methods = {}) {
  const values = new Map();
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    key: index => [...values.keys()][index] ?? null,
    get length() { return values.size; },
    ...methods
  };
  return values;
}

test.afterEach(() => {
  delete globalThis.localStorage;
});

test("不存在的键使用默认值，合法 JSON 正常往返", () => {
  const values = useStorageMock();
  assert.deepEqual(readJSON("missing", []), []);

  writeJSON("data", { ok: true });
  assert.equal(values.get("data"), '{"ok":true}');
  assert.deepEqual(readJSON("data", null), { ok: true });
});

test("损坏 JSON 不再静默回退为空数据", () => {
  useStorageMock({ getItem: () => "{broken" });
  assert.throws(
    () => readJSON("data", []),
    error => error instanceof StorageError && error.kind === "corrupt"
  );
});

test("浏览器禁用本地存储时返回 unavailable", () => {
  useStorageMock({ getItem: () => { throw new Error("blocked"); } });
  assert.throws(
    () => readJSON("data", []),
    error => error instanceof StorageError && error.kind === "unavailable"
  );
});

test("配额不足与序列化失败具有不同错误类别", () => {
  const quotaError = new Error("full");
  quotaError.name = "QuotaExceededError";
  useStorageMock({ setItem: () => { throw quotaError; } });
  assert.throws(
    () => writeJSON("data", { ok: true }),
    error => error instanceof StorageError && error.kind === "quota"
  );

  useStorageMock();
  const circular = {};
  circular.self = circular;
  assert.throws(
    () => writeJSON("data", circular),
    error => error instanceof StorageError && error.kind === "serialize"
  );
});

test("持久化失败时恢复最近一次成功保存的内存数据", () => {
  let rejectWrites = false;
  useStorageMock({
    setItem: () => {
      if (!rejectWrites) return;
      const error = new Error("full");
      error.name = "QuotaExceededError";
      throw error;
    }
  });

  state.current = "test";
  state.data = { employees: [{ id: "e1", name: "保存前" }] };
  persist();

  state.data.employees[0].name = "未保存的修改";
  rejectWrites = true;
  assert.throws(() => persist(), error => error.kind === "quota");
  assert.equal(state.data.employees[0].name, "保存前");
});

test("新组织导入任一步失败时回滚组织、指针、数据和内存", () => {
  let rejectOrganizationWrite = false;
  const values = useStorageMock({
    setItem: (key, value) => {
      if (rejectOrganizationWrite && key === STORAGE_PREFIX + "orgs") {
        const error = new Error("full");
        error.name = "QuotaExceededError";
        throw error;
      }
      values.set(key, String(value));
    }
  });
  const originalData = { employees: [{ id: "e1", name: "原员工" }], attendance: [], payroll: [] };
  const originalOrgs = [{ id: "old", name: "原组织" }];
  values.set(STORAGE_PREFIX + "orgs", JSON.stringify(originalOrgs));
  values.set(STORAGE_PREFIX + "current", "old");
  values.set(STORAGE_PREFIX + "old_data", JSON.stringify(originalData));
  state.orgs = structuredClone(originalOrgs);
  state.current = "old";
  state.data = structuredClone(originalData);

  rejectOrganizationWrite = true;
  assert.throws(
    () => importPreparedData(
      { id: "new", name: "新组织" },
      { employees: [{ id: "e2", name: "新员工" }], attendance: [], payroll: [] }
    ),
    error => error.kind === "quota"
  );

  assert.deepEqual(state.orgs, originalOrgs);
  assert.equal(state.current, "old");
  assert.deepEqual(state.data, originalData);
  assert.equal(values.has(STORAGE_PREFIX + "new_data"), false);
  assert.equal(values.get(STORAGE_PREFIX + "current"), "old");
  assert.deepEqual(JSON.parse(values.get(STORAGE_PREFIX + "orgs")), originalOrgs);
});

test("新组织导入成功后同时公布组织、指针和数据", () => {
  const values = useStorageMock();
  const originalData = { employees: [], attendance: [], payroll: [] };
  const importedData = { employees: [{ id: "e2", name: "新员工" }], attendance: [], payroll: [] };
  state.orgs = [{ id: "old", name: "原组织" }];
  state.current = "old";
  state.data = structuredClone(originalData);

  importPreparedData({ id: "new", name: "新组织" }, importedData);

  assert.deepEqual(state.orgs, [{ id: "old", name: "原组织" }, { id: "new", name: "新组织" }]);
  assert.equal(state.current, "new");
  assert.deepEqual(state.data, importedData);
  assert.equal(values.get(STORAGE_PREFIX + "current"), "new");
  assert.deepEqual(JSON.parse(values.get(STORAGE_PREFIX + "new_data")), importedData);
});

test("新组织导入在当前指针写入失败时撤销已写入的数据和组织", () => {
  let rejectCurrentOnce = true;
  const values = useStorageMock({
    setItem: (key, value) => {
      if (rejectCurrentOnce && key === STORAGE_PREFIX + "current") {
        rejectCurrentOnce = false;
        throw new Error("blocked");
      }
      values.set(key, String(value));
    }
  });
  const originalData = { employees: [{ id: "e1", name: "原员工" }], attendance: [], payroll: [] };
  const originalOrgs = [{ id: "old", name: "原组织" }];
  values.set(STORAGE_PREFIX + "orgs", JSON.stringify(originalOrgs));
  values.set(STORAGE_PREFIX + "current", "old");
  state.orgs = structuredClone(originalOrgs);
  state.current = "old";
  state.data = structuredClone(originalData);

  assert.throws(
    () => importPreparedData(
      { id: "new", name: "新组织" },
      { employees: [{ id: "e2", name: "新员工" }], attendance: [], payroll: [] }
    ),
    error => error.kind === "unavailable"
  );

  assert.deepEqual(state.orgs, originalOrgs);
  assert.equal(state.current, "old");
  assert.deepEqual(state.data, originalData);
  assert.equal(values.has(STORAGE_PREFIX + "new_data"), false);
  assert.equal(values.get(STORAGE_PREFIX + "current"), "old");
  assert.deepEqual(JSON.parse(values.get(STORAGE_PREFIX + "orgs")), originalOrgs);
});

test("普通新建组织复用事务写入，失败时不留下空壳组织", () => {
  let rejectOrganizationWrite = true;
  const values = useStorageMock({
    setItem: (key, value) => {
      if (rejectOrganizationWrite && key === STORAGE_PREFIX + "orgs") {
        rejectOrganizationWrite = false;
        throw new Error("blocked");
      }
      values.set(key, String(value));
    }
  });
  const originalData = { employees: [], attendance: [], payroll: [] };
  const originalOrgs = [{ id: "old", name: "原组织" }];
  values.set(STORAGE_PREFIX + "orgs", JSON.stringify(originalOrgs));
  values.set(STORAGE_PREFIX + "current", "old");
  state.orgs = structuredClone(originalOrgs);
  state.current = "old";
  state.data = structuredClone(originalData);

  assert.throws(() => addOrg("创建失败的组织"), error => error.kind === "unavailable");

  assert.deepEqual(state.orgs, originalOrgs);
  assert.equal(state.current, "old");
  assert.deepEqual(state.data, originalData);
  assert.deepEqual(
    [...values.keys()].filter(key => key.endsWith("_data")),
    []
  );
});

test("切换组织先读取目标数据，损坏数据不会改变当前指针", () => {
  const values = useStorageMock();
  const originalData = { employees: [{ id: "e1", name: "原员工" }], attendance: [], payroll: [] };
  state.orgs = [{ id: "old", name: "原组织" }, { id: "broken", name: "损坏组织" }];
  state.current = "old";
  state.data = structuredClone(originalData);
  values.set(STORAGE_PREFIX + "current", "old");
  values.set(STORAGE_PREFIX + "broken_data", "{broken");

  assert.throws(() => setCurrentOrg("broken"), error => error.kind === "corrupt");

  assert.equal(state.current, "old");
  assert.deepEqual(state.data, originalData);
  assert.equal(values.get(STORAGE_PREFIX + "current"), "old");
});

test("切换组织的当前指针保存失败时不替换页面内存", () => {
  const values = useStorageMock({
    setItem: (key, value) => {
      if (key === STORAGE_PREFIX + "current") throw new Error("blocked");
      values.set(key, String(value));
    }
  });
  const originalData = { employees: [{ id: "e1", name: "原员工" }], attendance: [], payroll: [] };
  const nextData = { employees: [{ id: "e2", name: "目标员工" }], attendance: [], payroll: [], settings: {} };
  state.orgs = [{ id: "old", name: "原组织" }, { id: "next", name: "目标组织" }];
  state.current = "old";
  state.data = structuredClone(originalData);
  values.set(STORAGE_PREFIX + "current", "old");
  values.set(STORAGE_PREFIX + "next_data", JSON.stringify(nextData));

  assert.throws(() => setCurrentOrg("next"), error => error.kind === "unavailable");

  assert.equal(state.current, "old");
  assert.deepEqual(state.data, originalData);
  assert.equal(values.get(STORAGE_PREFIX + "current"), "old");
});

test("快照最多保留十份，并支持单份删除和全部清理", () => {
  useStorageMock();
  state.current = "snapshot-test";
  state.data = { employees: [] };
  for (let index = 0; index < 11; index += 1) createSnapshot(`快照 ${index}`);

  const snapshots = listSnapshots();
  assert.equal(snapshots.length, 10);
  assert.equal(snapshots[0].reason, "快照 10");
  assert.equal(deleteSnapshot(snapshots[0].id), true);
  assert.equal(listSnapshots().length, 9);
  clearSnapshots();
  assert.deepEqual(listSnapshots(), []);
});

test("预计超过安全容量时在写入快照前拒绝", () => {
  useStorageMock();
  state.current = "large-snapshot";
  state.data = { payload: "x".repeat(2.4 * 1024 * 1024) };
  assert.throws(() => createSnapshot("超大快照"), error => error.kind === "quota");
  assert.deepEqual(listSnapshots(), []);
});

test("关闭强制校验时动态调休余额允许为负", () => {
  state.data = {
    settings: { halfDayMinutes: 240, overtimeToRest: true, overtimeToRestRatio: 1, enforceRestBalance: false },
    employees: [{ id: "e1", restSeedMinutes: 0 }],
    attendance: [{ empId: "e1", rec: { 1: { am: "调", pm: "", ot: "" } } }]
  };
  assert.equal(computeRestMinutes("e1"), -240);
});
