# 系统架构（ARCHITECTURE）

> 本文件说明 hr-workbench 的整体架构：技术选型、模块划分、数据流、存储结构，以及为"接后端、上规模"预留的扩展点。  
> 读者：开发者、架构评审、未来的接手同事。

---

## 1. 总览

hr-workbench 是一个 **零运行时依赖、纯前端、可离线** 的通用人事考勤薪资工作台。当前以浏览器 `localStorage` 为存储，但通过严格的数据层抽象，未来可以无缝切换到后端 API，而不需要修改任何业务模块。

```
┌──────────────────────────────────────────────────────────┐
│                          index.html                        │
│  结构（HTML 骨架）+ 顶部栏 + 今天要处理 + Tab 导航 + 4 模块    │
└───────────────┬──────────────────────────────────────────┘
                │ <script type="module" src="js/main.js">
┌───────────────▼──────────────────────────────────────────┐
│                          js/main.js                        │
│  入口：组装所有模块、绑定全局事件、window.__renderAll()        │
└───┬───────┬───────┬───────┬───────┬───────┬──────────────┘
    │       │       │       │       │       │
┌───▼───┐ ┌─▼───┐ ┌─▼────┐ ┌▼─────┐ ┌▼────┐ ┌▼──────────┐
│roster │ │att  │ │payroll│ │dash  │ │ ui │ │  store ←───┐ │
│花名册 │ │考勤 │ │ 薪资  │ │看板  │ │通用│ │  数据层     │ │
└───────┘ └─────┘ └───────┘ └──────┘ └────┘ └─────┬──────┘ │
                                                    │         │
                                            ┌───────▼──────┐  │
                                            │  config.js  │  │
                                            │  全局常量    │  │
                                            └──────────────┘  │
                                            ┌───────▼──────┐  │
                                            │ sample.js   │  │
                                            │ 示例数据+计算│  │
                                            └──────────────┘  │
┌──────────────────────────────────────────────────────────┘ │
│                      localStorage (wb_hr_*)                   │
│  按组织隔离：wb_hr_{orgId}_data                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 技术栈与原则

| 维度 | 当前选择 | 原因 |
|---|---|---|
| 语言 | 原生 JavaScript (ES Modules) | 零编译、零框架、易读、利于初学者 |
| 样式 | 原生 CSS（`:root` 变量 + 媒体查询） | 零 UI 库，完全可控 |
| 存储 | `localStorage` | 离线可用、无需服务器 |
| 图表 | 内联 SVG（手写） | 零图表库，体积小 |
| 导出 | 本地 `vendor/xlsx.mini.min.js`（SheetJS） | 零 CDN，离线可用 |
| 部署 | 静态文件 + GitHub Pages | 零运维 |

**铁律**
1. 业务模块绝不直接读写 `localStorage`，一律经过 `store.js`。
2. 任何模块改完数据后调用 `persist()`，再调用 `window.__renderAll()` 触发全局重绘。
3. 新代码必须带教材级中文注释。
4. 引入第三方库必须下载到 `vendor/` 本地目录，禁止引用 CDN。

---

## 3. 模块职责

| 文件 | 职责 | 对外暴露的关键 API |
|---|---|---|
| `config.js` | 全局常量：状态种类、颜色、社保比例 | `STATUSES` `STATUS_COLOR` `INSURANCE_RATIO` |
| `store.js` | **数据层**：读写存储、组织管理、数据迁移 | `state` `ensureSeed` `persist` `reloadCurrent` `addOrg` |
| `sample.js` | 示例数据生成、薪资计算 | `buildSample` `buildPayroll` `sumRec` |
| `ui.js` | 通用 UI：弹窗、下载、金额格式 | `openModal` `downloadFile` `fmtMoney` |
| `roster.js` | 花名册：增、删、改、排序 | `initRoster` `renderRoster` |
| `attendance.js` | 考勤：分时段网格、节假日、调休联动 | `initAttendance` `renderAttendance` |
| `payroll.js` | 薪资：计算、编辑、比例、导出 | `initPayroll` `renderPayroll` `recompute` |
| `dashboard.js` | 看板：KPI、出勤率环图、工资趋势 | `initDashboard` `renderDashboard` |
| `export.js` | Excel 导出（Phase 4 新增） | `exportRosterXlsx` `exportAttendanceXlsx` |
| `main.js` | 入口：组装与全局事件 | `renderAll`（挂到 `window.__renderAll`） |

---

## 4. 数据流

### 4.1 渲染循环
```
用户操作 → 业务模块改 state.data → persist() → window.__renderAll()
                                                    ├─ renderRoster()
                                                    ├─ renderAttendance()
                                                    ├─ renderPayroll()
                                                    ├─ renderDashboard()
                                                    └─ renderToday()  // 顶部"今天要处理"
```
为什么用 `window.__renderAll` 而不是模块间互相 import？  
→ 避免 ES Modules 的循环依赖（roster/attendance 都会互相触发布局变化）。挂载到 `window` 是一种"事件总线"式的折中。

### 4.2 组织切换
```
select 改变 → setCurrentOrg(id) → reloadCurrent() → window.__renderAll()
```

---

## 5. 存储结构

### 5.1 localStorage 键
```
wb_hr_orgs        → [{ id, name }, ...]           组织列表
wb_hr_current     → "org_xxx"                     当前组织 id
wb_hr_{orgId}_data → {                            某组织全部数据
  employees: [],   // 花名册
  attendance: [],  // 考勤
  payroll: [],     // 薪资
  holidays: {},    // 节假日（Phase 2）
  settings: {}     // 组织设置（Phase 2/3）
}
```

### 5.2 数据对象 schema（权威定义见 `docs/STANDARD.md`）
- **员工**：`{ id, name, dept, hireDate, baseSalary, restMinutes, insuranceBase }`
- **考勤**：`{ id, month, empId, rec: { [day]: { am, pm, ot } }, summary }`
- **薪资**：`{ id, month, empId, baseSalary, travel, bonus, overtime, comp, pers, gross, persTotal, tax, net, status }`

---

## 6. 数据迁移策略（向后兼容）

旧数据在 `ensureSeed` / `reloadCurrent` 后由 `store.js` 的迁移函数升级：
- 员工缺 `restMinutes` → 补 `0`；缺 `insuranceBase` → 补 `null`。
- 考勤 `rec` 若为 `{1:"√"}` 旧格式 → 自动转为 `{1:{am:"√",pm:"√",ot:""}}`。
- 缺 `holidays` / `settings` → 注入默认值（内置 2026 国家节假日）。
- 所有迁移都"只增不减"，绝不删除用户已有字段。

---

## 7. 扩展点（为接后端 / 上规模预留）

### 7.1 后端接入（最小改动）
只需把 `store.js` 里的 `readJSON/writeJSON` 改为 `fetch(...)`，页面模块零改动：
```js
// 未来示例
async function readJSON(key) {
  return fetch('/api/' + key).then(r => r.json());
}
async function writeJSON(key, val) {
  await fetch('/api/' + key, { method:'PUT', body: JSON.stringify(val) });
}
```

### 7.2 第三方库本地化
所有外部库放 `vendor/`，`index.html` 用相对路径引入，保证 GitHub Pages 与离线均可用。

### 7.3 开放接口（Phase 10）
在 `store.js` 预留适配器：
```js
store.importAttendance(records)  // 对接打卡机
store.exportToFinance()          // 对接财务系统
```

### 7.4 权限与多角色（Phase 6）
在 `main.js` 增加 `currentUser.role` 判断；敏感操作（改薪资）经 `ui.js` 二次确认。

---

## 8. 未来架构演进

| 阶段 | 架构变化 |
|---|---|
| MVP（当前） | 纯前端 + localStorage + 单页面 |
| 成长 | 引入后端 API（替换 store.js 内部实现），保留前端结构 |
| 成熟 | 增加权限服务、审批引擎、审计日志微服务 |
| 可上市 | 多租户（集团版）、SSO、开放 API、移动端 App |

当前架构的所有抽象（数据层、模块边界、vendor 目录）都是为上述演进铺路，避免将来重写。
