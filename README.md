# Pj16-CodeAgent构建

便携版 Claude Code 的源码构建区 + 权威标准所在项目（2026-08-11 全工作区重组后，由原 CODE2431 根目录迁入）。

## 本项目内容

- `_agent-src/` — Claude Code 源码 + 构建环境。包含 `src/`、`scripts/`、`package.json`、`bun.lock`、`node_modules/` 等。构建命令在 `cd _agent-src &&` 后执行（`bun install` / `bun run build:dev` / `bun run compile` / `bun run dev`）。
- `STANDARDS.md` — 权威标准文档（skill / plugin / MCP / changelog / 工作区 / 构建的全部约定），见 `@WrokSpace/.claude/CLAUDE.md` 顶部引用。
- `README.md` — 本文（原 CODE2431 根目录结构说明迁入后重写）。
- `CLAUDE.md` — 项目级 AI 指引（规则+指针型，架构细节在 `ARCHITECTURE.md`）。
- `ARCHITECTURE.md` — 代码架构文档（源码核心机制 + 内置网关/web 前端链路定案）。
- `LOG.md` — 项目变更日志（只追加）。
- `FEATURES.md` — feature flag 活审计。
- `.claude/` — 项目级配置（会话存档 + 跨会话记忆 `projects/memory/`），`settings.json` 按 Pj 权限同步惯例。
- `SubPj3-角色形象设计/` — 唯一现存子项目：#char 四态图源 + 界面动效/预览 demo。SubPj1（遥测前端）/SubPj2（私有化网关）实现已分别并入源码 `src/gateway/web/` 与 `src/gateway/localGateway.ts`（2026-08-29 起前端直改源码），子项目目录已移除。
- `refer/` — 界面设计参考截图。

## 构建与部署

- 构建命令（在 `_agent-src/` 内执行）：`bun install` / `bun run dev`（源码直跑）/ `bun run build:dev`（dev 构建 `cli-dev-<ts>.exe`，2026-08-25 起**默认含内置私有化网关**）/ `bun run build:dev:gateway`（显式网关版 `cli-dev-<ts>-PRIVATE_GATEWAY.exe`，等价 build:dev 仅命名带代号）/ `bun run compile`（正式编译 `dist/cli-<ts>.exe`）。
- 构建产物（2026-08-25 起 dev 构建直出项目根，免手动复制）：dev 构建（`build:dev` / `build:dev:gateway`）→ **项目根** `cli-dev-<YYYYMMDDHHMMSS>[-<flag>].exe`；正式编译 → `_agent-src/dist/cli-<YYYYMMDDHHMMSS>.exe`。带时间戳命名，独立保留。
- 部署/运行：构建完成即已在项目根，直接用带时间戳的产物 exe 启动（如 `cli-dev-<YYYYMMDDHHMMSS>.exe`；2026-08-28 起 PRIVATE_GATEWAY 进默认特性，`build:dev` 即含网关，产物名不再带 -PRIVATE_GATEWAY 代号），**重启会话/网关进程才生效**。**产物带时间戳是强制规范，不允许覆盖**（不设固定名部署副本）。当前最新构建：`cli-dev-20260902190533-PRIVATE_GATEWAY.exe`（**web 会话弹窗并入 WT 定稿**：spawn 去 -WindowStyle=并入已有 WT 窗口成可见新标签、与本地双击完全同源——09-02 三态实测 Minimized=独立 conhost 黑窗/Hidden=托管但隐身，均否决；前版 182758=「管理员窗口/无法并入 WT」根修（Minimized 令 WT 拒托管回落黑窗→Hidden）；140257=CLI 弹窗不抢焦点（WT 委托重设+windowingBehavior=useAnyExisting 并入已有窗口）。web 前端 sw v196：项目选择器全链 132534→133351→133728→134350→141709→161934→174829→175820→182616（弹层宽度根修/侧栏折叠按钮/折叠动画两轮/移除胶囊/排队图 404 根修+web 图 id 防撞/输入栏项目标识定稿/弹层选项行全称）；前版 123352=模型身份句措辞改「现在的底层是……」；150710=mDNS 定向 announce 推送（直连一次→域名永通自愈闭环）+协议层终局取证（iOS 拒收 unsolicited 单播应答=AP 吞多播场景死局定论，PC hosts 手加 floria.local 为兜底真相）；2026-08-31 发布版本 11 asset=142738（P1 渲染双条根修/内存优化链 P1-P4/审批补发/计时定格，sw v187）；2026-09-03 发布版本 12 asset=190533，见下「版本控制」；历史部署链见 `LOG.md`，此处不再累积**）。注：`build:dev` 产物名不带 `-PRIVATE_GATEWAY` 代号但同样含内置网关；发布/部署惯例用 `build:dev:gateway` 的带代号产物（v11 即是）。
- codegraph 索引：`_agent-src/src/.codegraph/`（相对路径存储，随 `_agent-src` 迁移有效），MCP 查询带 `projectPath=Pj16-CodeAgent构建/_agent-src/src`。

## 版本控制（git）

- 2026-08-15 git init，远程 `bruce2431/codeagent-build`，**仅跟踪 `_agent-src/`、`README.md`、`STANDARDS.md` 三个路径**；`CLAUDE.md`/`LOG.md`/子项目目录/报告 md 由项目根 `.gitignore` 排除，`.gitignore` 本身不入库。
- 构建产物 exe 不在 git（`.gitignore` 排除 `*.exe`），部署副本只在项目根。
- **GitHub Release 发布（2026-08-31 起）**：版本号 = exe 内嵌的 dev 版本串（构建自动生成，格式 `2.1.<sw>-dev.<日期>.t<UTC时分秒>.sha<HEAD 8 位>`，如 `2.1.87-dev.20260831.t062738.sha60f851fa`）；流程 = commit+push → 同名 tag → GitHub Release（notes 按 LOG 当日条目主题分组）→ 附对应 gateway 代号版 exe 为 asset。发布记录见 `LOG.md`（最新：版本 12，2026-09-03 发布，tag `2.1.87-dev.20260902.t110533.sha6e045fe1`，asset `cli-dev-20260902190533-PRIVATE_GATEWAY.exe`；上版：版本 11，2026-08-31，asset `cli-dev-20260831142738-PRIVATE_GATEWAY.exe`）。

## 新结构速览（便携根 = `@WrokSpace`）

```
@WrokSpace/
├── .claude/              ← 全局配置根（settings/skills/plugins/记忆/会话）
│   └── .claude-portable  ← 便携标记（在配置根内部，不可移动/删除）
├── Pj16-CodeAgent构建/   ← 本项目（源码构建区 + 权威标准）
│   ├── SubPj3-角色形象设计/ ← #char 四态图源 + 界面动效 demo（唯一现存子项目）
│   ├── refer/            ← 界面设计参考截图
│   └── <时间戳>-<名称>/   ← 临时任务目录（发布/验证等，用毕归档 .trash）
└── Pj1-…/Pj17-…/         ← 其他项目
```

## 归档

- 废弃文件按工作区「禁止删除」规则归档到 `@WrokSpace/.trash/YYYY-MM-DD/`。
