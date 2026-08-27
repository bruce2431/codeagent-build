# Pj16-CodeAgent构建

便携版 Claude Code 的源码构建区 + 权威标准所在项目（2026-08-11 全工作区重组后，由原 CODE2431 根目录迁入）。

## 本项目内容

- `_agent-src/` — Claude Code 源码 + 构建环境。包含 `src/`、`scripts/`、`package.json`、`bun.lock`、`node_modules/` 等。构建命令在 `cd _agent-src &&` 后执行（`bun install` / `bun run build:dev` / `bun run compile` / `bun run dev`）。
- `STANDARDS.md` — 权威标准文档（skill / plugin / MCP / changelog / 工作区 / 构建的全部约定），见 `@WrokSpace/.claude/CLAUDE.md` 顶部引用。
- `README.md` — 本文（原 CODE2431 根目录结构说明迁入后重写）。
- `.claude/` — 项目级配置（会话存档等），`settings.json` 按 Pj 权限同步惯例。

## 构建与部署

- 构建命令（在 `_agent-src/` 内执行）：`bun install` / `bun run dev`（源码直跑）/ `bun run build:dev`（dev 构建 `cli-dev-<ts>.exe`，2026-08-25 起**默认含内置私有化网关**）/ `bun run build:dev:gateway`（显式网关版 `cli-dev-<ts>-PRIVATE_GATEWAY.exe`，等价 build:dev 仅命名带代号）/ `bun run compile`（正式编译 `dist/cli-<ts>.exe`）。
- 构建产物（2026-08-25 起 dev 构建直出项目根，免手动复制）：dev 构建（`build:dev` / `build:dev:gateway`）→ **项目根** `cli-dev-<YYYYMMDDHHMMSS>[-<flag>].exe`；正式编译 → `_agent-src/dist/cli-<YYYYMMDDHHMMSS>.exe`。带时间戳命名，独立保留。
- 部署/运行：构建完成即已在项目根，直接用带时间戳的产物 exe 启动（如 `cli-dev-<YYYYMMDDHHMMSS>-PRIVATE_GATEWAY.exe`），**重启会话/网关进程才生效**。**产物带时间戳是强制规范，不允许覆盖**（不设固定名部署副本）。当前最新部署：`cli-dev-20260826235715-PRIVATE_GATEWAY.exe`（审批/提问链路完整化：A1 允许空输入修复 + 描述/建议透传 + 确认送达/无限等待 + WS 自动重连 + 设置服务统一 E + 重命名加固 B2 + 实时工具折叠 stopReason 回合判定/增量重建/单工具行 + 前端 sw v124/cache-bust ?v=126；此前：内置网关 PRIVATE_GATEWAY 默认开启 + /server restart 继承 token + web 重命名运行中 CLI 输入栏实时同步 + web 新会话首条消息即时渲染 + 「独立」徽标改项目编号气泡 + extractLastJsonStringField 跨格式覆盖根治；此前：重命名真正根因修复：extractLastJsonStringField 跨格式覆盖（上游 free-code 潜伏 bug）+ 网关复用 CLI saveCustomTitle/saveAgentName；此前：web 会话重命名复用 CLI 函数版 sw v102 + 项目「+」先到初始化界面 + 钉顶系列 + 模型 web/CLI 同步 + 文件变更结构化 fileChange + 钉顶修复2 sw v97：展开「已处理」折叠恒走临时让位、回复正文真撑满才永久解除；此前：模型 tab 设为默认模型 sw v96 + 钉顶「已处理」折叠展开算正文 sw v95 + statusline 显示思考等级 + 模型切换去广播兜底改精确路由 sw v94 + dsh ContextMeter 上下文小圆圈 sw v93 + 钉顶生命周期回归修复 sw v92 + 模型切换改每会话 + CLI 渲染思考等级 sw v91 + 模型 seat 同步 + 思考等级 Off/Low/High/Max sw v91 + 模型切换改凭据池源 sw v90 + 模型切换/思考等级切换接通网关 sw v89 + web 消息注入根治 sw v88 + 提问渲染链路修复 sw v88 + dsh 前端同步 sw v86-v88 + 钉顶解除逻辑修复 sw v83 + Web 容器 backend 能力 + 黑框根治 + 预览启动体验 sw v74-v82，已发布 GitHub Release v8）。
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
