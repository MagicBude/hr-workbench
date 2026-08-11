# HR Workbench · 通用人事考勤薪资工作台

一个**零依赖、纯前端、可离线使用**的通用人事工作台，适用于任意公司的考勤与薪资管理。支持多组织（公司）数据隔离、浏览器本地存储与 JSON 备份，可一键部署到 GitHub Pages，在手机和电脑上使用。

> A zero-dependency, pure-frontend generic HR workbench usable by any company for attendance & payroll. Features multi-org data isolation, browser-local storage with JSON backup, and modules for employee roster, attendance log, monthly payroll, and a dashboard. Deployable to GitHub Pages.

---

## 功能特性

- **员工花名册**：支持试用/在职/停薪/离职状态、离职归档、员工回收站和调休余额
- **考勤记录**：按「月份 × 员工 × 日期 × 时段」登记 9 种状态，按应出勤工时统一统计
- **薪资核算**：自动估算五险一金、个税和实发，支持人工税额覆盖及草稿/已确认/已发放状态
- **月度看板**：在职人数、出勤率环形图、工资趋势折线图（全部内联 SVG，不引图表库）
- **多组织分区**：可在多家公司间切换，localStorage 按组织分键（这是数据分区，不是账号权限隔离）
- **数据备份**：导出 / 导入 JSON，清空有二次确认
- **今天要处理**：逾期考勤、待核算薪资置顶标红，一键直达
- **数据安全**：导入/清空/回收前自动快照，最多保留 10 份并可在设置中心恢复

---

## 目录结构（多文件、模块化）

本项目刻意采用**多文件 + 原生 ES Modules** 结构（而非单文件），目的是便于长期维护、阅读与后续接后端：

```
hr-workbench/
├── index.html          # 页面骨架（只放结构，不含逻辑）
├── css/
│   └── styles.css       # 全部样式（含移动端适配）
└── js/
    ├── config.js        # 全局常量：状态、颜色、五险一金比例
    ├── domain.js        # 可测试的考勤、员工、薪资与输入校验口径
    ├── store.js         # 数据层：localStorage 读写（接后端只改这里）
    ├── ui.js            # 通用工具：弹窗 / 下载 / 金额格式化 / 日期
    ├── sample.js        # 示例数据与薪资计算函数（数据均为虚构）
    ├── roster.js        # 模块一：员工花名册
    ├── attendance.js    # 模块二：考勤记录
    ├── payroll.js       # 模块三：薪资核算
    ├── settings.js      # 组织级功能、考勤、薪资、界面和数据安全设置
    ├── dashboard.js     # 模块四：月度看板 + SVG 图表
    └── main.js          # 入口：组装所有模块、绑定事件、首次渲染
```

> 关键业务口径和边界配有简洁中文注释；建议按 `main.js → 各页面模块 → domain.js → store.js` 的顺序阅读。

---

## 文档

本项目用 `docs/` 目录统一管理所有说明性文档，方便归档与协作：

| 文档 | 作用 |
|---|---|
| [`docs/PLAN.md`](docs/PLAN.md) | 分阶段实施计划（Phase 1–10 与当前进度） |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 系统架构：模块划分、数据流、存储、扩展点 |
| [`docs/SPEC.md`](docs/SPEC.md) | 功能规格：各模块详细行为规格与验收标准 |
| [`docs/STANDARD.md`](docs/STANDARD.md) | 开发标准：代码规范、数据格式、命名、计算口径 |
| [`docs/CODE_COMMENTING_STANDARD.md`](docs/CODE_COMMENTING_STANDARD.md) | 教材型代码与注释规范：文件头、分区、命名、解释深度与检查清单 |
| [`docs/AUDIT_AND_IMPROVEMENT_PLAN.md`](docs/AUDIT_AND_IMPROVEMENT_PLAN.md) | 安全、质量与性能审查结论及分批执行计划 |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | 产品路线图与愿景：从 MVP 到可上市系统的演进 |
| [`docs/OPTIMIZATION_BACKLOG.md`](docs/OPTIMIZATION_BACKLOG.md) | 产品审视、优化优先级、验收标准与实施追踪 |

---

## 快速开始（本地预览）

因为使用了 ES Modules（`type="module"`），浏览器出于安全策略**不允许直接双击打开** `index.html`，需要一个本地静态服务器：

```bash
cd hr-workbench
python -m http.server 8000
# 然后浏览器访问 http://localhost:8000
```

> 没有 Python 也可用任意静态服务器，例如 `npx serve`。部署到 GitHub Pages 后则无此限制。

---

## 数据存储与隐私

- 数据保存在当前浏览器的 **localStorage 明文存储**中，应用本身不会上传数据。
- 这是**单设备本地工具**，没有登录、权限控制、服务端加密或访问审计，不具备企业级数据安全能力。
- **不适合共享电脑、公共终端或多人共同使用**；浏览器配置目录的其他使用者也可能读取这些数据。
- 顶部「遮罩」可以在临时离开时隐藏页面内容，但它不是密码锁，不会加密或删除 localStorage 数据。
- 首次打开会注入一份**虚构**的示例组织「示例科技有限公司」，用于展示效果；点右上角「清空」即可清零后录入真实数据。
- **部署后页面是公网可访问的**，因此请勿在示例里预填真实姓名、薪资等隐私；真实数据请在本机录入。

---

## 部署到 GitHub Pages

1. 把本仓库推到 GitHub（`https://github.com/MagicBude/hr-workbench`）。
2. 仓库 **Settings → Pages → Build and deployment → Source 选 "Deploy from a branch"**，分支选 `master`，目录选 `/ (root)`。
3. 等待约 1 分钟，获得 `https://magicbude.github.io/hr-workbench/` 公网地址。
4. 手机浏览器打开 → 分享 → 「添加到主屏幕」，即可当 APP 使用。

---

## 给开发者：持久化演进

当前所有本地存储键、迁移、偏好和快照都集中在 `js/store.js`，业务页面不直接操作 `localStorage`。接入异步后端时建议在该边界新增 repository/service 层，并同步处理加载态、网络错误、并发版本和身份权限；不能简单理解为只替换一个函数体。

- 现在：`store.js` 用 `localStorage` 读写（见 `readJSON` / `writeJSON` / `persist`）。
- 将来：先保持领域函数和页面渲染接口稳定，再逐步把同步存储 API 升级为可等待的 repository 操作。

这种「业务逻辑不直接碰存储细节」的分层，是长期维护和可演进的关键。

本地质量检查：

```powershell
npm run verify
```

`verify` 会对 `js/*.js` 逐文件执行语法检查并运行领域测试；提交前还应在 `localhost:8090` 回归花名册、考勤、薪资、看板和设置中心。

---

## 技术栈

- 原生 HTML + CSS + JavaScript（ES Modules）
- **零框架、零 CDN、零构建**：不依赖 React/Vue、不引外部图表库，图表用内联 SVG 手画
- 纯静态，可直接托管到任意静态空间（GitHub Pages / Vercel / Nginx …）
