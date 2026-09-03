# Free Code Fork 标准（STANDARDS）

> 本 fork（便携版 Claude Code 重构源码）已与官方产生结构性差异，官方文档不再适用。
> 本文件是**权威标准**：新建/修改 skill、plugin、MCP、changelog、工作区内容时以本文为准。
> 优先级：**本文 > `.claude/CLAUDE.md` 对应章节 > 官方文档**。

## 1. 总则 / 设计原则

| 原则 | 说明 |
|---|---|
| **便携优先** | 整个 `@WrokSpace` 可整体拷到任意盘符/路径，配置、插件、记忆、凭证不失效 |
| **全相对路径（红线）** | 任何命令/配置/脚本/引用一律相对路径，禁止 `C:\...`、`C:/...`、写死盘符、写死用户目录 |
| **扩展只走两个口** | 简单工作流 = skill（`.claude/skills/`）；带 MCP/引擎 = plugin（`.claude/plugins/`）。目录严格分离 |
| **数据随插件走** | 插件活数据放插件目录内（如 `brain/`），随插件整体拷贝，不依赖外部路径 |
| **MCP 只经插件注册** | 禁止在 `settings.json` 的 `mcpServers` 或项目根 `.mcp.json` 单独注册 |
| **会话级生效** | MCP 工具/插件/hook 改动**重启会话才生效**（会话启动时一次性加载） |

## 2. 目录结构标准

```
@WrokSpace/               ← 便携根 = 主工作区（日常产出、项目、临时任务）
├── .claude/              ← 便携全局配置根（settings/skills/plugins；会话与自动记忆均在项目级）
│   └── .claude-portable  ← 便携标记（在配置根内部，不可移动/删除）
├── Pj16-CodeAgent构建/   ← 源码构建区 + 权威标准（原 CODE2431 根 _agent-src 迁入）
│   ├── _agent-src/       ← 构建源码（src/ scripts/ package.json node_modules/ …）
│   ├── STANDARDS.md      ← 本文
│   └── README.md         ← 目录结构说明
├── Pj1-…/Pj15-…/         ← 项目
├── .trash/YYYY-MM-DD/    ← 归档（禁止删除，只归档）
├── LOG.md                ← 工作区 LOG
├── README.md             ← 工作区规范
└── STATUS.md             ← 工作区状态
```

- `.claude/` 内部：
  - `skills/` — 纯 skill（json-canvas / officecli / wetrace-wechat-tool）
  - `plugins/` — 插件（neturon / codegraph）
  - `plugins/` 下 `marketplaces/`、`data/`、`known_marketplaces.json` 是**系统管理目录，勿动**；缓存清理只动 `cache/` 三层，不碰插件目录
  - `projects/` — 旧版全局自动记忆桶（2026-08-11 起自动记忆改项目级，遗留桶不再读写），App 管理
  - `sessions/`、`history.jsonl` — 旧版会话存储，App 管理（新会话写入项目 `.claude/projects/*.jsonl` 平铺目录）

### 2.1 会话 / 自动记忆存储布局（2026-08-11 扁平化）

| 数据 | 位置 | 说明 |
|---|---|---|
| **会话** | `<项目>/.claude/projects/*.jsonl` | **项目本地、平铺**（不再按启动目录分桶），随项目文件夹打包/归档不丢失 |
| **自动记忆** | `<项目>/.claude/projects/memory/` | **项目本地、平铺**，随项目文件夹打包/归档不丢失；`MEMORY.md` + 各主题文件 |

- 会话目录：`getProjectDir()`（`sessionStoragePortable.ts`）＝ `<项目>/.claude/projects`（**平铺**）。跨项目会话列表（`/resume`、stats、cleanup、insights 等）用**逐级向上扫描**：`getProjectSessionDirsUpToHome(cwd)` / `getSessionProjectsParentsUpToHome(cwd)` 从 CWD 逐级收集 `<dir>/.claude/projects` 直至配置根，再加配置根本身的 projects 目录 → 从任何子目录启动都能看到该项目全部会话。
- 自动记忆：`getAutoMemPath()`（`memdir/paths.ts`），优先级 = `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` → settings.json `autoMemoryDirectory`（policy/local/user，排除 projectSettings）→ 默认 `<项目>/.claude/projects/memory/`（镜像会话目录 `getProjectDir()`，随项目移动）。`getMemoryBaseDir()` 仍锚定全局配置根，仅服务**用户级 agent-memory**（`<配置根>/agent-memory/`）与旧路径检测；自动记忆不再落全局根。
- **启动位置决定记忆**：记忆按「启动时 CWD 的项目根」解析，写入该项目 `.claude/projects/memory/`——从 `@WrokSpace` 启动读写工作区记忆，从 `@WrokSpace/Pj2-…` 启动读写 Pj2 记忆。统一从 `@WrokSpace/cli-dev.exe` 启动。从同一项目不同子目录启动，会话/记忆共用同一平铺目录，不再碎片化。
- **归档**：要归档某项目时，直接 zip 整个项目文件夹（含 `.claude/projects/`）即带走会话**和自动记忆**（两者同目录），无需单独导出。
- **迁移现状（2026-08-11 完成）**：一次性扁平化迁移（`@WrokSpace/.claude/scripts/migrate-flat-sessions.mjs`）已收尾——各项目与配置根的 `<sanitized>` 旧桶内 `*.jsonl` / `<sessionId>/` 子目录 / `memory/` 全部上移合并到 `.claude/projects/` 顶层，跨桶按 sessionId 去重保留最新（仅 `fs.rename`，mtime/会话名不变），旧桶与重复文件移 `.trash/YYYY-MM-DD/`。原「当前会话 harness 记忆桶」由用户手动平铺合并；并发活跃会话桶在会话重启改走平铺写入后由脚本归档。另发现并归档了 4 个项目根级的**更早期**遗留记忆桶（`<项目>/<sanitized>/memory/`，早于 `.claude/projects` 结构，内容与平铺完全一致）。当前全工作区已无任何 `<sanitized>` 桶，全部平铺。

## 3. 便携配置根与路径红线

**配置根解析**（`Pj16-CodeAgent构建/_agent-src/src/utils/envUtils.ts` `getClaudeConfigHomeDir`，优先级从高到低）：

1. `CLAUDE_CONFIG_DIR` 环境变量
2. exe 旁边的 `.claude/`（**须带配置根标记**：`.claude-portable`/`.claude.json`/`settings.json`/`plugins`/`skills`/`commands`/`credentials.json`/`history.jsonl` 任一存在才认；**只有 `projects/` 不算** → 项目本地会话目录不会误判）
3. 从 exe 目录**逐级向上**找 `.claude/.claude-portable` 标记 → 命中用「该 `.claude` 目录」
4. 兜底 `~/.claude`

**硬性约束**：
- `.claude/.claude-portable` 和 `.claude/` **必须留在 `@WrokSpace` 根目录**。挪进子文件夹后，exe 副本从 `@WrokSpace\<项目>\` 运行向上找不到标记 → 配置掉回 `~/.claude`，插件/记忆/凭证全失效。
- 写命令/配置/脚本引用一律相对路径；只在极少数无法用相对路径处（如 hook 子进程 CWD 不固定）先与用户确认。

## 4. Skill 标准

### 4.1 定义
- 一组 markdown 工作流指令（`SKILL.md`）+ 可选脚本/参考文档，**纯 skill 不注册 MCP**。
- 需要 MCP / 引擎 / 活数据时**升级为 plugin**（§5），不要塞进 skills/。

### 4.2 目录结构
```
.claude/skills/<name>/
├── SKILL.md          # 必须
└── references/       # 可选（如 EXAMPLES.md）
```

### 4.3 SKILL.md 格式
```yaml
---
name: <英文短横线名，如 json-canvas>
description: <何时用/怎么用，一句话，供 Skill 工具自动命中>
---
# <标题>
## 工作流
1. ...
```
- frontmatter 必填 `name` + `description`；name 用英文短横线。
- 复杂脚本/工具全文存插件的 `l3.raw/`，SKILL.md 只写工作流 + 相对路径引用（见 §7）。

### 4.4 发现与注册（无 manifest 门槛）
- 项目 skills 加载器从 **originalCwd 逐级向上**扫 `.claude/skills/<name>/SKILL.md`（便携下命中 `@WrokSpace/.claude/skills/`）。
- **SKILL.md 存在即注册**；bare 模式 / projectSettings 源禁用时跳过。
- 触发：Skill 工具按 description 自动命中，或 `/skill名`。

### 4.5 规则
- 纯 skill 目录**不带** `.claude-plugin/plugin.json`——带了的目录会被插件加载器当插件（§5），skills 加载器反而跳过它。

## 5. Plugin 标准

### 5.1 定义
- 目录内**含 `.claude-plugin/plugin.json` 即视为插件**（manifest 驱动）。
- 带 MCP 服务器、引擎代码、活数据（如 neturon `brain/`）、模板的扩展一律走 plugin。

### 5.2 plugin.json（清单）
```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "一句话说明",
  "author": { "name": "bruce2431" },
  "homepage": "https://…（可选）"
}
```
- 必填：`name`（英文短横线、无空格）。建议：`version`(semver)、`description`、`author`。
- 完整 schema（`PluginManifestSchema`，顶层均为可选 partial）还支持：`hooks` / `commands` / `agents` / `skills` / `outputStyles` / `channels` / `mcpServers`（内联或「相对 JSON 路径 / `.mcpb`」引用）/ `lspServers` / `settings`（合并时只保留白名单键）/ `userConfig`。
- 运行时未知顶层字段被静默剥掉（容错）；开发期用 `claude plugin validate` 严格校验（typo/非 kebab-case/缺字段会给告警）。

### 5.3 目录结构
```
.claude/plugins/<name>/
├── .claude-plugin/plugin.json   # 必须；name 决定 MCP 命名空间
├── .mcp.json                    # 可选；注册本插件 MCP 服务器
├── skills/                      # 可选；插件 skill，触发 /插件名:skill名
├── docs/                        # 可选
└── 引擎代码 / 活数据(brain/) / 模板
```

### 5.4 发现与注册（两个来源，manifest 驱动）
| 来源 | 目录 | source 标记 |
|---|---|---|
| @skills-dir | 项目 `.claude/skills/<name>/`（含 plugin.json 的才算插件） | `skillsdir` |
| @plugins-dir | 便携插件目录 `@WrokSpace/.claude/plugins/<name>/`（=`getPluginsDirectory()` = 配置根 plugins/） | `pluginsdir` |

- **判定**：子目录含 `.claude-plugin/plugin.json` → 加载为插件；纯 skill 目录（无 manifest）→ 交给 skills 加载器；系统条目（`marketplaces/`、`data/`、`*.json`）无 manifest 自动跳过。
- **常驻启用**（always enabled）、**不复制到 cache**——活在项目内，随配置根整体搬（便携）。
- 加载连带效果：
  - 插件 skills 以 `/<插件name>:<skill名>` 触发
  - 插件根 `.mcp.json` **自动注册 MCP 服务器**（`loadPluginMcpServers`）
  - MCP 工具命名空间 = `mcp__plugin_<plugin.json 的 name>_<server>__*`（**与目录名无关**）
- gates：bare 模式 / projectSettings 源禁用时跳过。

### 5.5 注册优先级与覆盖
- `--plugin-dir`（session 插件）**>** 同名 @skills-dir 插件（同名时 skillsdir 被过滤）。
- marketplace 安装插件按名被 session/skillsdir 覆盖，**除非**被 managed（policySettings）锁定。
- 依赖缺失 → `verifyAndDemote` 临时禁用（session 级，不写 settings）。

### 5.6 生命周期
- 会话启动时一次性加载；改动**重启会话才生效**。
- `.mcp.json` 用 `${CLAUDE_PLUGIN_ROOT}` 指向插件根定位脚本（相对路径，便携）。

### 5.7 现状清单
- `neturon/`（name=`neturon-rag`）— RAG 引擎：`mcp/` 引擎 + `brain/` 活数据 + `Neturon-Template/` 模板 + `docs/`
- `codegraph/`（name=`codegraph`）— 代码知识图谱 MCP，索引 `Pj16-CodeAgent构建/_agent-src/src/.codegraph/`
- ~~`qwen-mm/`~~（已移除 2026-08-24 → `.trash/2026-08-24/qwen-mm/`）— Qwen-MM-Plugins 便携版（2026-08-14）：core（本地多模态读取/可视化 MCP + skill）+ api（云端 Qwen VL/Omni/ASR，需 DashScope key）。引擎 `src/`（精简 pyproject：core viz 全依赖 + api 依赖并入 `[project].dependencies`，entry `qwen-mm-plugins-core`/`qwen-mm-plugins-api`）+ `skills/qwen-mm-plugins-core/`、`skills/qwen-mm-plugins-api/` + `config/config` 活数据。`.mcp.json` 两个 server，均 `uvx --from ${CLAUDE_PLUGIN_ROOT}`（本地构建，不联网）：`qwen-mm-plugins-core` / `qwen-mm-plugins-api`，env `PYTHONUTF8=1`（防 Windows GBK `UnicodeEncodeError`）+ `QWEN_MM_CONFIG_DIR=${CLAUDE_PLUGIN_ROOT}/config`（便携）。config 写 `DASHSCOPE_API_KEY` + `DASHSCOPE_BASE_URL`（用户百炼专属网关 `…maas.aliyuncs.com/compatible-mode/v1`，可覆盖默认 dashscope 地址）。MCP 工具命名空间 `mcp__plugin_qwen-mm_qwen-mm-plugins-core__*` / `mcp__plugin_qwen-mm_qwen-mm-plugins-api__*`。移除原因：用户主动移除视觉插件；config 内 `DASHSCOPE_API_KEY` 已随目录进 `.trash` 未删除。MCP 工具下次重启会话后消失。
- ~~`telemetry-monitor/`~~（已移除 2026-08-14 → `.trash/2026-08-14/telemetry-monitor/`）：会话遥测 MCP（notify_progress 推飞书 / get_session_status 读会话摘要）。`get_session_status` 用的旧桶 glob（`projects/*/*.jsonl`）与平铺会话存储不兼容已失效，功能被 SubPj1/SubPj2 `/gateway/sessions` 覆盖；`notify_progress` 飞书推送能力随 SubPj2 网关接管。MCP 工具下次重启会话后消失。

## 6. MCP 服务器标准

- 只通过插件 `.mcp.json` 注册（`"command"` + `"args"`，可含 `${CLAUDE_PLUGIN_ROOT}`）。
- **参数来源仅两个**：config 或指令运行时显式提供；**禁写死默认值**（如 `top_k` 必填，`default_res`/`model` 已在 config）。
- **序列化必须用管线序列化器**：cog.json → `_write_cog_json(_serialize_cog)`，mem.json → `serialize_revelant_inline`；**禁裸 `json.dump(indent=2)`**——numpy `float32` 等会直接序列化崩溃。
- **MCP 必须完全复刻管线逻辑**（管线=成熟摹本，MCP 须完全实现，不允许近似）。
- 检索类工具返回 `precog.record_id` 时，调用方**必须立即** `rag_fill_precog` 填 accuracy/description（`true`=直接回答 / `revelant`=相关非直接 / `false`=噪音）。
- 已知坑：`rag_cog_context` 曾报 `Object of type float32 is not JSON serializable`（cog 层 numpy 分数未转 Python float）——MCP 侧修复时注意。

## 7. 记忆 / RAG 标准（neturon）

- **三层管线**：`l3.raw`（脚本/工具全文）→ `l2.mem`（记忆片段，blocks[0] 必须是原始 query）→ `l1.cog`（概念/社群/precog）。
- **写记忆**：脚本/工具全文存 `l3.raw/`，`core_file` 只存**相对路径**引用；同一源不重复记录（复用同一源）。
- **检索（双检索）**：`rag_search` 查 mem（唯一写 precog）+ `rag_cog_context` 全查五层（概念/社群/precog节点/聚合节点/mem）。
- 命中后用 `rag_source` 取完整 `men.content` 确认真实上下文，按 `core_file[].path` 复用脚本，不重复造轮子。
- 同一话题有失败（pattern=try）和成功（pattern=succeed）两条时，认准成功那条。
- 提及人物名（ljj/lcx/gky/sc/lyg 等）先 `rag_should_search`，人名 = explicit 触发。
- 查询用自然语句（做了什么/怎么做的），不要关键词堆砌（BGE 对自然语句友好）。

## 8. Changelog 标准

- **源文件 = `changes.md`**（exe 旁或 CWD）。App 启动时 `syncLocalChangesToCache()` 把它同步进 `.claude/cache/changelog.md`（供 "What's new" 展示）。
- `cache/changelog.md` 是 **App 展示缓存**，会被同步/网络拉取**覆盖**，**禁止手工往里写**。
- **禁止**在 `@WrokSpace` 根创建 `CHANGELOG.md`——官方惯例在本 fork 不适用，App 不读它（2026-08-07 已踩坑归档）。
- 格式：`## <版本号/日期>` + `- 条目`；支持非 semver 键（如日期），解析器会自动按日期排序。
- 工作区的变更记录走 `@WrokSpace/LOG.md`（LOG 只追加），两者职责不同，不混用。

## 9. 工作区约定（@WrokSpace）

- **🔴 所有文件只能在项目内建立（红线）**：任何生成/创建/修改文件都必须落在 `Pj16-CodeAgent构建/**` 内（Pj16 会话：本项目与工作区根 `LOG.md` + 规范四件（`CLAUDE.md`/`README.md`/`STATUS.md`/`.hermes.md`）自动放行，其它落点写操作**弹审批**（`defaultMode: default`，仅 `rm`/`rmdir` 直接拒绝）；Pj1/Pj2/Pj11/Pj13/Pj14/Pj15 各自 `.claude/settings.json` 为 deny 锁死，只写自身 + 根 5 件）。**严禁在项目外创建任何文件**，包括但不限于：系统临时目录（`/tmp`、`%TEMP%`）、桌面根、其它盘符、工作区根等。截图/临时产物一律放任务目录或项目内子目录（如 `SubPj1-*/shots/`）（2026-08-12 曾把截图拷到 `/tmp` 违规，须避免）。
- **LOG 只追加不修改**，`patch` 追加模式，时间戳从 `date` 命令获取。
- **临时任务目录命名**：`YYYYMMDDHHMMSS-名称`（紧凑时间戳无方括号）；存量 `[YYYY-MM-DD-HH-MM-SS]-名称` 旧目录不改名（含其中会话，改名断接续）。
- **单文件产出不建临时目录**：单个 md/脚本/图等直接建 `YYYYMMDDHHMMSS-名称.ext` 放目标位置（如项目根 `Pj16-CodeAgent构建/`），多文件才建 `YYYYMMDDHHMMSS-名称/` 目录（`.hermes.md` 规则A）。
- **禁止删除**：废弃内容移到 `.trash/YYYY-MM-DD/`。
- **操作后立即验证结果**。
- 项目变更需**同时更新**项目内 LOG 和工作区 LOG；状态目录树见 `STATUS.md`。
- 门控规则见 `.hermes.md`（禁止捏造事实、禁止删除、临时任务命名、操作后验证）。
- **不自己运行** `启动.bat` / `start_site.py` 启动本地站点（0zijun 等由用户自己双击启动；需要站点运行时告知用户去启动）。

## 10. 构建标准（Pj16-CodeAgent构建/_agent-src）

- 源码构建区 `Pj16-CodeAgent构建/_agent-src/`：`src/` `scripts/` `package.json` `bun.lock` `tsconfig.json` `env.d.ts` `FEATURES.md` `node_modules/`。
- 命令（均在 `cd Pj16-CodeAgent构建/_agent-src &&` 后执行）：
  - `bun install` — 装依赖
  - `bun run build:dev` → `Pj16-CodeAgent构建/_agent-src/cli-dev-<YYYYMMDDHHMMSS>`（dev 构建；产物带时间戳命名）
  - `bun run build:dev:full` → 开全部实验 feature（产物 `cli-dev-<ts>`，时间戳不同不覆盖）
  - `bun run compile` → `Pj16-CodeAgent构建/_agent-src/dist/cli-<YYYYMMDDHHMMSS>`（正式编译）
  - `bun run dev` — 源码直跑
- 产物命名（`scripts/build.ts`，2026-08-14 起）= `<前缀>-<YYYYMMDDHHMMSS>[-<显式 --feature 代号>]`，显式 feature 代号用 `+` 连接（如 `cli-dev-20260814114321-PRIVATE_GATEWAY.exe`）；前缀 dev=`cli-dev`、compile=`dist/cli`。默认三个 feature（VOICE_MODE + BUILTIN_EXPLORE_PLAN_AGENTS + PRIVATE_GATEWAY，2026-08-25 网关默认化）与 `--feature-set=dev-full` 不进文件名。
- 产物是**自包含单文件二进制**（`bun build --compile --bytecode --packages bundle`），拷到任意项目目录即可用，运行时不需要 src/node_modules。**exe 产物带时间戳是强制规范，不允许覆盖**（禁止覆盖成固定名如 `cli-dev.exe`）；部署/换新 = 直接用新时间戳 exe 启动，旧产物原样保留。
- codegraph 索引：`Pj16-CodeAgent构建/_agent-src/src/.codegraph/`（相对路径存储，随 src 迁移有效）；MCP 查询带 `projectPath=Pj16-CodeAgent构建/_agent-src/src`。
- dev 版本号从 git 派生（本目录 2026-08-15 起已 git init，sha 取自 git HEAD；仓库仅跟踪 `_agent-src/`、`README.md`、`STANDARDS.md`，其余项目文件由 .gitignore 排除）。

## 11. 与官方版本的主要差异

| 项 | 官方 Claude Code | 本 fork |
|---|---|---|
| 全局配置根 | `~/.claude` | `@WrokSpace/.claude`（`.claude/.claude-portable` 标记逐级向上找） |
| 插件发现 | marketplace + `--plugin-dir` | 额外扫描 `.claude/plugins/`（@pluginsdir 原地插件） |
| MCP 命名空间 | `mcp__<server>__*` | `mcp__plugin_<plugin name>_<server>__*` |
| Changelog | 根 CHANGELOG.md / GitHub 拉取 | `changes.md` → `cache/changelog.md` 同步 |
| 构建 | npm 官方发布流程 | `bun --compile --bytecode` 自包含单文件 |
| 项目 `.claude/` | trust/onboarding 触发创建 | **惰性创建**（首次写项目设置才 mkdir；会话存储的 `.claude/projects/` 写会话时自动建） |
| 会话/记忆存储 | 全局 `~/.claude/projects/` 统一 | **会话/自动记忆均项目级、平铺**：会话 `<项目>/.claude/projects/*.jsonl`，记忆 `<项目>/.claude/projects/memory/` |
| 权限规则 `@/` 前缀 | 无此语法 | **自定义特性，生效中**：`@/` 解析到便携根（`.claude-portable` 标记所在 `.claude` 的父目录 = `@WrokSpace`），Edit/Read 的 allow/deny 规则均有效（`filesystem.ts` `patternWithRoot`） |
| `.claude` 目录编辑 | 可直接编辑 | **危险目录守卫**：路径任意段 = `.claude`（`.claude/worktrees` 除外）→ acceptEdits 与项目级 allow 被无视，强制弹「编辑自己配置」审批；唯一豁免 = **会话级** allow 规则 `/.claude/**` 或 `~/.claude/**`（审批框选项 2 即写入，会话结束失效） |
| 品牌身份 | Claude Code / Anthropic | **白标 Floria**（2026-09-01 P0 落实：身份句族 11 处 + env 假情报 3 句 + 主提示散句 + 工具描述 + guide agent 改造为 Floria guide；`CLAUDE_CODE_ATTRIBUTION_HEADER` 全局关；D 层功能性标识 `.claude`/`CLAUDE_*`/工具协议等不动） |

## 12. 常见坑速查

- **`.claude/.claude-portable` / `.claude/` 挪走** → exe 副本向上找不到标记 → 配置掉回 `~/.claude`，插件/记忆/凭证全失效。
- **exe 副本放进带配置根标记的项目 `.claude/`**（含 `.claude.json`/`settings.json`/`plugins`/`skills` 等）→ 配置根判定第 2 步静默切到项目本地，插件/记忆/凭证全失效（Pj2 已踩坑，见记忆 portable_config_behavior）。**只有 `projects/` 的目录不算配置根**。
- **会话/自动记忆项目级、平铺**（2026-08-11 起，不再按启动目录分 `<sanitized>` 桶）：会话写入 `<项目>/.claude/projects/*.jsonl`，自动记忆写入 `<项目>/.claude/projects/memory/`，均随项目打包归档不丢失。跨项目会话列表用逐级向上扫描。
- **项目级 `.claude/` 启动不自动建** → 只在首次写项目设置（`/permissions`、`/config`、MCP 审批、插件装项目 scope）才惰性创建；要手动放 `CLAUDE.md` 或空 `settings.json`。
- **settings.json hooks 用 CWD 相对路径**（`.claude/...`）→ 在 `@WrokSpace\[项目]\` 等子目录会话里 `recall_hook.py`/`statusline.mjs` 静默跳过（RAG 自动触发失效），只在 `@WrokSpace` 根目录跑才命中。
- **MCP/插件/hook 改动不热加载** → 必须重启会话。
- **编辑 `.claude` 下文件总弹审批** → 是危险目录守卫（`isDangerousFilePathToAutoEdit`）在拦，不是权限规则失效；审批框选项 2 = 写会话级 `/.claude/**` 豁免（会话结束失效）。`@/` 前缀规则本身有效，勿建议改写成绝对路径（违反便携红线）。
- **MCP 序列化** → 禁裸 `json.dump(indent=2)`，用管线序列化器，否则 float32 崩溃。

## 13. 项目预览页 Web 容器（backend 容器）标准

> 预览页不止静态 HTML——项目 `.claude/preview/preview.json` 声明 `backend` 字段 → Pj16 网关 `localGateway.ts` 懒加载 **spawn 后端进程**、前端 iframe **直连后端端口**（仿 Hugging Face Spaces）。首个案例：Pj14-AI动画制作 官方 ComfyUI 前端 + 真实 ComfyUI 后端（2026-08-19 落地）。

### 13.1 preview.json 的 backend 字段

```json
{
  "name": "pj14-animation-workbench",
  "version": "3.0.0",
  "backend": {
    "cmd": [".venv/Scripts/python.exe", "main.py", "--port", "{port}", "--listen", "127.0.0.1", "--cpu"],
    "cwd": "../../comfyui-backend",
    "port": 0,
    "idleMinutes": 10,
    "readyPath": "/api/system_stats"
  }
}
```

- `cmd`：spawn 命令数组；可含 `{port}` 占位符（网关 spawn 时替换为实际分配端口）；`cmd[0]` 相对路径按 `cwd` resolve（node spawn 只按进程 cwd 解析，须手动 resolve）。
- `cwd`：相对 preview.json 所在目录（`../../comfyui-backend` → 项目根下 comfyui-backend）。
- `port`：`0` = 网关从 8130 起探测顺延（上限 8160）；显式端口则固定。
- `idleMinutes`：后端无活跃持续该时长被空闲回收（默认继承 `GATEWAY_IDLE_MINUTES`=10 分钟）。
- `readyPath`：就绪探测路径（默认 `/api/system_stats`，项目后端自身 API，非网关前缀）。

### 13.2 网关机制（localGateway.ts，已实现）

- `findProjects` 读 `<项目>/.claude/preview/preview.json`，有 `backend` → 项目附 `hasBackend` + `backendCfg`。
- `GET /gateway/backend?label=`（受 token 保护）：ensureBackend（未起则 spawn）→ `{url, port, pid}`；无 backend → 404。
- spawn：`{port}` 替换 → cmd[0] resolve 到 cwd → `spawn`（env 加 PORT，日志落盘 `便携根/.claude/backend-<safeLabel>.log`）；就绪探测窗口 120×200ms（容忍 ~22s 冷启动）。
- **就绪探测用原生 net socket**（`backendReady`）：编译产物 node:http 的 request 对 aiohttp/Python 后端会挂起，net 直连写 HTTP 头读响应状态（200/404 即就绪）。
- 生命周期：`stopLocalGateway` 遍历 killAllBackends（child.kill + taskkill /F /T /PID 兜底）+ 停回收 timer；空闲回收每 60s（仅 `--gateway` 模式）。
- 前端三级加载：① `/gateway/backend` 命中 → iframe 直连 + 60s 心跳防误回收；② 静态 preview；③ 默认项目主页兜底。

### 13.3 安全

- 后端只监听 `127.0.0.1`（ComfyUI `--listen` 默认）；后端 URL 获取须过网关 token（`/gateway/backend` 属 `/gateway/*` 自动受保护）。
- 后端文件写路径由后端自身约束（如 ComfyUI `--input-directory`/`--output-directory`），粘贴图片落到项目内目录。

### 13.4 远程端同源反代 /bp/<label>/（2026-08-27）

- 背景：iframe 直连 `http://127.0.0.1:<port>/` 只在本机浏览器成立——手机/平板等远程宿主上 127.0.0.1 指向设备自身 → 连接拒绝、预览覆盖层永转圈；`/preview/*` 静态兜底因子资源不带 query token 全 401，不可用。
- 路由：`/bp/<label>/<path>?<query>` → `http://127.0.0.1:<port>/<path>?<query>`。rest/search 原样透传（保留原始 %xx 编码，不二次解码重组，防中文路径双重编码错乱）；`proxyBackendRequest` 双向流式管道（媒体大文件不落盘），请求侧剥 hop-by-hop + host + cookie（不向项目后端泄露 floria_bp 票证），响应侧剥 hop-by-hop + 上游 set-cookie（防作用域泄漏），Location 改写回 `/bp` 前缀。后端仍只绑回环，访问面不变。
- 鉴权：不靠 query token（页面内相对子请求必裸奔）。`/gateway/backend` 成功响应种 `HttpOnly` cookie `floria_bp`（Path=/bp、SameSite=Lax、24h）；票证存网关内存 Map（含 label 白名单，多项目并行预览互不顶掉，sweep 过期）。`/bp/*` 凭 cookie + 白名单放行，否则 401；label 须命中 findProjects 且 hasBackend，否则 404。
- 前端分流：`openProjectPreview` 按 `location.hostname ∉ {127.0.0.1, localhost}` 判远程宿主 → iframe 用 `/bp/<label>/`（cookie 由上一拍 `/gateway/backend` 响应种下，子请求自动携带）；本机保持直连 `d.url` 零开销。心跳 60s `GET /gateway/backend` 不变（保 lastActive + 续票证）。
- 配套约束：**经 /bp 代理的项目前端 API 一律相对路径**（根绝对路径 `/delete` 等在 /bp 前缀下会指回网关根 404）——Pj15 已清理全部根绝对 API 路径（2026-08-27 21:18）。
