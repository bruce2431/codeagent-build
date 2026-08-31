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
- `.claude/` — 项目级配置（会话存档等），`settings.json` 按 Pj 权限同步惯例。

## 构建与部署

- 构建命令（在 `_agent-src/` 内执行）：`bun install` / `bun run dev`（源码直跑）/ `bun run build:dev`（dev 构建 `cli-dev-<ts>.exe`，2026-08-25 起**默认含内置私有化网关**）/ `bun run build:dev:gateway`（显式网关版 `cli-dev-<ts>-PRIVATE_GATEWAY.exe`，等价 build:dev 仅命名带代号）/ `bun run compile`（正式编译 `dist/cli-<ts>.exe`）。
- 构建产物（2026-08-25 起 dev 构建直出项目根，免手动复制）：dev 构建（`build:dev` / `build:dev:gateway`）→ **项目根** `cli-dev-<YYYYMMDDHHMMSS>[-<flag>].exe`；正式编译 → `_agent-src/dist/cli-<YYYYMMDDHHMMSS>.exe`。带时间戳命名，独立保留。
- 部署/运行：构建完成即已在项目根，直接用带时间戳的产物 exe 启动（如 `cli-dev-<YYYYMMDDHHMMSS>.exe`；2026-08-28 起 PRIVATE_GATEWAY 进默认特性，`build:dev` 即含网关，产物名不再带 -PRIVATE_GATEWAY 代号），**重启会话/网关进程才生效**。**产物带时间戳是强制规范，不允许覆盖**（不设固定名部署副本）。当前最新构建：`cli-dev-20260831142738-PRIVATE_GATEWAY.exe`（mDNS 多接口化+watch 自愈：热点场景 floria.local 解析根修/iPad 实测闭环 + 遥测新会话启动与同步双根修：webSessionExe 自引用+注册痕迹防乒乓+取证日志 + CLI 会话标题回退 firstPrompt 根修（B2 共享权威反扫） + 网关重启审批卡补弹（pending 补发跨重连） + 处理完成刷新后计时定格（isEndStop 统一 stop_sequence） + 旁白/思考区 inline code 灰底，前端 sw v187；**历史部署链见 `LOG.md`，此处不再累积**）。
- codegraph 索引：`_agent-src/src/.codegraph/`（相对路径存储，随 `_agent-src` 迁移有效），MCP 查询带 `projectPath=Pj16-CodeAgent构建/_agent-src/src`。

## 版本控制（git）

- 2026-08-15 git init，远程 `bruce2431/codeagent-build`，**仅跟踪 `_agent-src/`、`README.md`、`STANDARDS.md` 三个路径**；`CLAUDE.md`/`LOG.md`/子项目目录/报告 md 由项目根 `.gitignore` 排除，`.gitignore` 本身不入库。
- 构建产物 exe 不在 git（`.gitignore` 排除 `*.exe`），部署副本只在项目根。

## 新结构速览（便携根 = `@WrokSpace`）

```
@WrokSpace/
├── .claude/              ← 全局配置根（settings/skills/plugins/记忆/会话）
│   └── .claude-portable  ← 便携标记（在配置根内部，不可移动/删除）
├── Pj16-CodeAgent构建/   ← 本项目（源码构建区 + 权威标准）
│   ├── SubPj1-遥测网页/   ← 会话查看器前端（public/ → src/gateway/web/）
│   ├── SubPj2-私有化网关/ ← 内置局域网网关方案/文档
│   └── SubPj3-角色形象设计/ ← #char 四态图源
└── Pj1-…/Pj15-…/         ← 其他项目
```

## 归档

- 废弃文件按工作区「禁止删除」规则归档到 `@WrokSpace/.trash/YYYY-MM-DD/`。
