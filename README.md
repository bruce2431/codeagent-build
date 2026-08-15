# Pj16-CodeAgent构建

便携版 Claude Code 的源码构建区 + 权威标准所在项目（2026-08-11 全工作区重组后，由原 CODE2431 根目录迁入）。

## 本项目内容

- `_agent-src/` — Claude Code 源码 + 构建环境。包含 `src/`、`scripts/`、`package.json`、`bun.lock`、`node_modules/` 等。构建命令在 `cd _agent-src &&` 后执行（`bun install` / `bun run build:dev` / `bun run compile` / `bun run dev`）。
- `STANDARDS.md` — 权威标准文档（skill / plugin / MCP / changelog / 工作区 / 构建的全部约定），见 `@WrokSpace/.claude/CLAUDE.md` 顶部引用。
- `README.md` — 本文（原 CODE2431 根目录结构说明迁入后重写）。
- `.claude/` — 项目级配置（会话存档等），`settings.json` 按 Pj 权限同步惯例。

## 构建与部署

- 构建产物：`_agent-src/cli-dev-<YYYYMMDDHHMMSS>[-<flag>].exe`（dev 构建）、`_agent-src/dist/cli-<YYYYMMDDHHMMSS>.exe`（正式编译）；带时间戳命名，独立保留。
- 部署/运行：直接用带时间戳的产物 exe 启动（如 `cli-dev-<YYYYMMDDHHMMSS>-PRIVATE_GATEWAY.exe`，放项目根）。**产物带时间戳是强制规范，不允许覆盖**（不设固定名部署副本）。
- codegraph 索引：`_agent-src/src/.codegraph/`（相对路径存储，随 `_agent-src` 迁移有效），MCP 查询带 `projectPath=Pj16-CodeAgent构建/_agent-src/src`。

## 新结构速览（便携根 = `@WrokSpace`）

```
@WrokSpace/
├── .claude/              ← 全局配置根（settings/skills/plugins/记忆/会话）
│   └── .claude-portable  ← 便携标记（在配置根内部，不可移动/删除）
├── Pj16-CodeAgent构建/   ← 本项目（源码构建区 + 权威标准）
└── Pj1-…/Pj15-…/         ← 其他项目
```

## 归档

- 废弃文件按工作区「禁止删除」规则归档到 `@WrokSpace/.trash/YYYY-MM-DD/`。
