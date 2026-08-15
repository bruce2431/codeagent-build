# Feature Flags Audit

Audit date: 2026-07-29 (initial: 2026-03-31)

This repository currently references 88 `feature('FLAG')` compile-time flags.
I re-checked them by bundling the CLI once per flag on top of the current
external-build defines and externals. Result:

- 74 flags bundle cleanly in this snapshot
- 13 flags still fail to bundle
  （原 18 项中 `REACTIVE_COMPACT`、`COORDINATOR_MODE`、`MONITOR_TOOL`、`REVIEW_ARTIFACT`、`WORKFLOW_SCRIPTS` 已恢复，见下文对应条目；`DIRECT_CONNECT` 退回 broken——此前"已恢复"未经打包验证，见下条）
  （2026-08-14：CCR 认证族五 flag（BRIDGE_MODE/CCR_AUTO_CONNECT/CCR_MIRROR/CCR_REMOTE_SETUP/DAEMON）+ 远程/云端方向 `DIRECT_CONNECT`/`SSH_REMOTE`/`KAIROS`/`KAIROS_DREAM`/`PROACTIVE` 共 10 个已放弃，见下文各条目【已放弃】标注，不恢复；均不在任何 feature 集，源码门控保留（编译期 tree-shake））

Important: "bundle cleanly" does not always mean "runtime-safe". Some flags
still depend on optional native modules, claude.ai OAuth, GrowthBook gates, or
externalized `@ant/*` packages.

## Build Variants

- `bun run build`
  Builds the regular external binary at `./cli`.
- `bun run compile`
  Builds the regular external binary at `./dist/cli`.
- `bun run build:dev`
  Builds `./cli-dev` with a dev-stamped version and experimental GrowthBook key.
- `bun run build:dev:full`
  Builds `./cli-dev` with the entire current "Working Experimental Features"
  bundle from this document, minus `CHICAGO_MCP`. That flag still compiles,
  but the external binary does not boot cleanly with it because startup
  reaches the missing `@ant/computer-use-mcp` runtime package.

## Default Build Flags

- `VOICE_MODE`
  【涉及 auth：运行时需 claude.ai OAuth】
  This is now included in the default build pipeline, not just the dev build.
  It enables `/voice`, push-to-talk UI, voice notices, and dictation plumbing.
  Runtime still depends on claude.ai OAuth plus either the native audio module
  or a fallback recorder such as SoX.

## Working Experimental Features

These are the user-facing or behavior-changing flags that currently bundle
cleanly and should still be treated as experimental in this snapshot unless
explicitly called out as default-on.

### Interaction and UI Experiments

- `AWAY_SUMMARY`
  Adds away-from-keyboard summary behavior in the REPL.
- `HISTORY_PICKER`
  Enables the interactive prompt history picker.
- `HOOK_PROMPTS`
  Passes the prompt/request text into hook execution flows.
- `KAIROS_BRIEF`
  Enables brief-only transcript layout and BriefTool-oriented UX without the
  full assistant stack.
- `KAIROS_CHANNELS`
  Enables channel notices and channel callback plumbing around MCP/channel
  messaging.
- `LODESTONE`
  Enables deep-link / protocol-registration related flows and settings wiring.
- `MESSAGE_ACTIONS`
  Enables message action entrypoints in the interactive UI.
- `NEW_INIT`
  Enables the newer `/init` decision path.
- `QUICK_SEARCH`
  Enables prompt quick-search behavior.
- `SHOT_STATS`
  Enables additional shot-distribution stats views.
- `TOKEN_BUDGET`
  Enables token budget tracking, prompt triggers, and token warning UI.
- `ULTRAPLAN`
  Enables `/ultraplan`, prompt triggers, and exit-plan affordances.
- `ULTRATHINK`
  Enables the extra thinking-depth mode switch.
- `VOICE_MODE`
  Enables voice toggling, dictation keybindings, voice notices, and voice UI.
- `STREAMLINED_OUTPUT`
  Enables streamlined message-output transformation in headless `stream-json`
  mode when `CLAUDE_CODE_STREAMLINED_OUTPUT=true`（`cli/print.ts` 门控）.

### Agent, Memory, and Planning Experiments

- `AGENT_MEMORY_SNAPSHOT`
  Stores extra custom-agent memory snapshot state in the app.
- `AGENT_TRIGGERS`
  Enables local cron/trigger tools and bundled trigger-related skills.
- `AGENT_TRIGGERS_REMOTE`
  Enables the remote trigger tool path.
- `BUILTIN_EXPLORE_PLAN_AGENTS`
  Enables built-in explore/plan agent presets.
- `CACHED_MICROCOMPACT`
  Enables cached microcompact state through query and API flows.
- `COMPACTION_REMINDERS`
  Enables reminder copy around compaction and attachment flows.
- `EXTRACT_MEMORIES`
  Enables post-query memory extraction hooks.
- `PROMPT_CACHE_BREAK_DETECTION`
  Enables cache-break detection around compaction/query/API flow.
- `TEAMMEM`
  Enables team-memory files, watcher hooks, and related UI messages.
- `VERIFICATION_AGENT`
  Enables verification-agent guidance in prompts and task/todo tooling.

### Tools, Permissions, and Remote Experiments

- `BASH_CLASSIFIER`
  Enables classifier-assisted bash permission decisions.
- `BRIDGE_MODE`
  Enables Remote Control / REPL bridge command and entitlement paths.
  【Remote Control / CCR 认证族】运行时需 claude.ai OAuth 订阅 + GrowthBook `tengu_ccr_bridge` 门；`setup-token`/`CLAUDE_CODE_OAUTH_TOKEN`/Bedrock/Console 登录均被排除。
  【已放弃 2026-08-14】不恢复：云端远程控制目标被 SubPj2 内置网关（PRIVATE_GATEWAY 进程内 localGateway）覆盖（本地网页查看/注入，无 OAuth、数据不出本机）；已从 `build.ts` `fullExperimentalFeatures` 剔除，源码门控代码保留（编译期 tree-shake）。
- `CCR_AUTO_CONNECT`
  Enables the CCR auto-connect default path.
  【Remote Control / CCR 认证族】默认自动连 CCR，走 OAuth + GrowthBook `tengu_cobalt_harbor`。
  【已放弃 2026-08-14】同上：网关随 PRIVATE_GATEWAY 编译进 exe 常驻即"默认可用"，无需云端自动连；已从 feature 集剔除。
- `CCR_MIRROR`
  Enables outbound-only CCR mirror sessions.
  【Remote Control / CCR 认证族】只出不进镜像会话，走 OAuth + GrowthBook `tengu_ccr_mirror`。
  【已放弃 2026-08-14】镜像转发对应实现已在本地落地：`conversationDisplay.ts` 导出 `{role,blocks[]}` + `exportConversationToServer` POST `/api/conversation` + `sendSessionActivity` 状态上报 → 网关 → floria 网页；已从 feature 集剔除。
- `CCR_REMOTE_SETUP`
  Enables the remote setup command path.
  【Remote Control / CCR 认证族】`/web` 远程 setup 命令，同 CCR OAuth 认证。
  【已放弃 2026-08-14】本地网关 `/server on` 即起、无需 OAuth 配码，无对应需求；已从 feature 集剔除。
- `CHICAGO_MCP`
  Enables computer-use MCP integration paths and wrapper loading.
- `CONNECTOR_TEXT`
  Enables connector-text block handling in API/logging/UI paths.
- `MCP_RICH_OUTPUT`
  Enables richer MCP UI rendering.
- `NATIVE_CLIPBOARD_IMAGE`
  Enables the native macOS clipboard image fast path.
- `POWERSHELL_AUTO_MODE`
  Enables PowerShell-specific auto-mode permission handling.
- `TREE_SITTER_BASH`
  Enables the tree-sitter bash parser backend.
- `TREE_SITTER_BASH_SHADOW`
  Enables the tree-sitter bash shadow rollout path.
- `UNATTENDED_RETRY`
  Enables unattended retry behavior in API retry flows.
- `PRIVATE_GATEWAY`
  【内置私有化网关，默认关】注册 `/server` 指令（on/off/status 开关内置网关：进程内启动 `src/gateway/localGateway.ts`，node:http + ws，遥测端 WS `send` → `messageQueueManager.enqueue` 注入本进程 REPL，与打字同路径；无独立进程/spawn/AGENT_CWD；会话列表/读取/SSE 基于便携根）。**网页前端内嵌打包**：权威 `src/gateway/web/`（由 SubPj1/public 同步）→ `scripts/gen-web-assets.ts`（build.ts 每次构建前自动运行）base64 内联成 `src/gateway/web-assets.generated.ts` 打进 exe，静态服务内嵌优先、磁盘 SubPj public 仅开发兜底；前端改动需重新构建才生效。纯本地指令，不涉 OAuth/GrowthBook/Anthropic API。默认构建不含（commands.ts 门控 require 被 tree-shake，`/server` 不出现）。构建启用：`bun run build:dev:gateway`（= build.ts `--dev --feature=PRIVATE_GATEWAY`）。

## Bundle-Clean Support Flags

These also bundle cleanly, but they are mostly rollout, platform, telemetry,
or plumbing toggles rather than user-facing experimental features.

- `ABLATION_BASELINE`
  CLI ablation/baseline entrypoint toggle.
- `ALLOW_TEST_VERSIONS`
  Allows test versions in native installer flows.
- `ANTI_DISTILLATION_CC`
  Adds anti-distillation request metadata.
- `BREAK_CACHE_COMMAND`
  Injects the break-cache command path.
- `COWORKER_TYPE_TELEMETRY`
  Adds coworker-type telemetry fields.
- `DOWNLOAD_USER_SETTINGS`
  Enables settings-sync pull paths.
- `DUMP_SYSTEM_PROMPT`
  Enables the system-prompt dump path.
- `FILE_PERSISTENCE`
  Enables file persistence plumbing.
- `HARD_FAIL`
  Enables stricter failure/logging behavior.
- `IS_LIBC_GLIBC`
  Forces glibc environment detection.
- `IS_LIBC_MUSL`
  Forces musl environment detection.
- `PERFETTO_TRACING`
  Enables perfetto tracing hooks.
- `SKILL_IMPROVEMENT`
  Enables skill-improvement hooks.
- `SKIP_DETECTION_WHEN_AUTOUPDATES_DISABLED`
  Skips updater detection when auto-updates are disabled.
- `SLOW_OPERATION_LOGGING`
  Enables slow-operation logging.
- `UPLOAD_USER_SETTINGS`
  Enables settings-sync push paths.

## Compile-Safe But Runtime-Caveated

These bundle today, but I would still treat them as experimental because they
have meaningful runtime caveats:

- `VOICE_MODE`
  【涉及 auth：需 claude.ai OAuth】
  Bundles cleanly, but requires claude.ai OAuth and a local recording backend.
  The native audio module is optional now; on this machine the fallback path
  asks for `brew install sox`.
- `NATIVE_CLIPBOARD_IMAGE`
  Bundles cleanly, but only accelerates macOS clipboard reads when
  `image-processor-napi` is present.
- `BRIDGE_MODE`, `CCR_AUTO_CONNECT`, `CCR_MIRROR`, `CCR_REMOTE_SETUP`
  【Remote Control / CCR 认证族】Bundle cleanly, but are gated at runtime on claude.ai OAuth plus GrowthBook
  entitlement checks.
  【已放弃 2026-08-14】整族放弃：云端远程控制目标被 SubPj2 内置网关覆盖，已从 `build.ts` `fullExperimentalFeatures` 剔除（不再编入 dev-full），源码门控代码保留（编译期 tree-shake 裁掉）。
- `KAIROS_BRIEF`, `KAIROS_CHANNELS`
  Bundle cleanly, but they do not restore the full missing assistant stack.
  They only expose the brief/channel-specific surfaces that still exist.
- `CHICAGO_MCP`
  Bundles cleanly, but the runtime path still reaches externalized
  `@ant/computer-use-*` packages. This is compile-safe, not fully
  runtime-safe, in the external snapshot.
- `TEAMMEM`
  Bundles cleanly, but only does useful work when team-memory config/files are
  actually enabled in the environment.

## Recently Restored (2026-07-29)

These 16 flags were restored by creating the missing stub files. The stubs
compile and bundle cleanly, but most are runtime-disabled (`isEnabled: () => false`)
— they exist so the build passes, but their features are inert unless activated.

- `AUTO_THEME` — stub `systemThemeWatcher.js` watches OSC 11 (5s poll)
- `BG_SESSIONS` — stub `bg.js` handlers log "not available"
- `BUDDY` — stub command, disabled
- `BUILDING_CLAUDE_APPS` — stub `.md` assets for all languages
- `COMMIT_ATTRIBUTION` — stub `attributionHooks.js` (no-ops)
- `FORK_SUBAGENT` — stub command + `UserForkBoilerplateMessage`, disabled
- `HISTORY_SNIP` — stub command + `SnipTool` + `snipProjection`, disabled
- `KAIROS_GITHUB_WEBHOOKS` — stub `SubscribePRTool` + `subscribe-pr` command + `UserGitHubWebhookMessage`, disabled
- `KAIROS_PUSH_NOTIFICATION` — stub `PushNotificationTool`, disabled
- `MCP_SKILLS` — stub `mcpSkills.js` returns `[]`
- `MEMORY_SHAPE_TELEMETRY` — stub `memoryShapeTelemetry.js` (no-ops)
- `OVERFLOW_TEST_TOOL` — stub `OverflowTestTool`, disabled
- `RUN_SKILL_GENERATOR` — stub `runSkillGenerator.js` registers disabled skill
- `TEMPLATES` — stub `templateJobs.js` + `jobs/classifier.js`
- `TORCH` — stub command, disabled
- `TRANSCRIPT_CLASSIFIER` — stub prompt `.txt` files for all three classifier modes

## Broken Flags With Partial Wiring But Medium-Sized Gaps

These do have meaningful surrounding code, but the missing piece is larger
than a single wrapper or asset.

- `BYOC_ENVIRONMENT_RUNNER`
  Missing `src/environment-runner/main.js`.
- `CONTEXT_COLLAPSE`
  Missing `src/tools/CtxInspectTool/CtxInspectTool.js`.
- `COORDINATOR_MODE`
  ~~Missing `src/coordinator/workerAgent.js`（`tools/AgentTool/builtInAgents.ts` 门控下 require）。`coordinator/coordinatorMode.ts` 已有真实实现，仅 workerAgent.js 这一缺口。~~ ✅ 已恢复（2026-08-12）：`src/coordinator/workerAgent.ts` 完整实现 `getCoordinatorAgents()`，返回两个 built-in agent——`coordinator`（tools=`COORDINATOR_MODE_ALLOWED_TOOLS`，prompt=`getCoordinatorSystemPrompt()`）与 `worker`（tools=`ASYNC_AGENT_ALLOWED_TOOLS` − `INTERNAL_WORKER_TOOLS`，独立 worker prompt）。`INTERNAL_WORKER_TOOLS` 已从 `coordinatorMode.ts` 导出，worker 工具白名单与其用户上下文广告一致。`subagent_type: 'worker'` 派遣现可经 `AgentTool.tsx:286` 正常解析。已用 `bun run ./scripts/build.ts --dev --feature=COORDINATOR_MODE` 全量打包验证（EXIT:0）。
- `DAEMON`
  【Remote Control / CCR 认证族】Missing `src/commands/remoteControlServer/index.js`（`commands.ts` `feature('DAEMON') && feature('BRIDGE_MODE')` 门控下 require，认证同 bridge）。
  【已放弃 2026-08-14】不恢复：DAEMON 想做的"常驻远程控制服务"已由 SubPj2 内置网关以**进程内**形态实现（localGateway 随 PRIVATE_GATEWAY 编译进 exe、随 CLI 常驻，node:http+ws），无需独立守护进程；会话状态/进度推送由 `conversationDisplay.ts` 上报网关承担（原 telemetry-monitor 插件能力，插件已于 2026-08-14 归档 .trash）。该 flag 本就不在任何 feature 集内（不在 defaultFeatures 也不在 fullExperimentalFeatures），仅保留审计标记。
- `DIRECT_CONNECT`
  ❌ 仍 broken（2026-08-12 打包复核发现"已恢复"未经验证）：`main.tsx:4065` `import('./server/parseConnectUrl.js')` 与 `main.tsx:4091` `import('./server/connectHeadless.js')` 均无法解析（`src/server/` 下无对应文件，仅存 `createDirectConnectSession.ts` + `directConnectManager.ts`）。`--feature=DIRECT_CONNECT` 打包报 `Could not resolve`。需补 `server/parseConnectUrl.ts`（解析 `cc://` URL）与 `server/connectHeadless.ts`（`claude open <cc-url> -p` headless 打印模式）后再验证。
  【已放弃 2026-08-14】`claude open <cc://url>` 连接外部直连会话服务属远程执行方向，与本地化方向（数据不出本机、内置网关本机查看）不符，不恢复。源码门控（main.tsx `feature('DIRECT_CONNECT')`）+ 残留实现（directConnectManager/createDirectConnectSession/useDirectConnect）保留（编译期 tree-shake）。
- `EXPERIMENTAL_SKILL_SEARCH`
  Missing `src/services/skillSearch/{localSearch,prefetch,featureCheck}.js`（`commands.ts` / `query.ts` / `constants/prompts.ts` 分别 require）。
- `MONITOR_TOOL`
  ~~Missing `src/tools/MonitorTool/MonitorTool.js`.~~ ✅ 已恢复（2026-08-12）：补全 4 个文件——`tools/MonitorTool/MonitorTool.tsx`（buildTool 产出 `Monitor` 工具，`exec()` + `spawnShellTask({..., kind:'monitor'})` 后台监控进程，流式通知，streaming-only）、`tasks/MonitorMcpTask/MonitorMcpTask.ts`（`MonitorMcpTask` / `killMonitorMcp` / `killMonitorMcpTasksForAgent` / `isMonitorMcpTask`）、`components/permissions/MonitorPermissionRequest/MonitorPermissionRequest.tsx`、`components/tasks/MonitorMcpDetailDialog.tsx`。已在 `tools.ts` / `PermissionRequest.tsx` / `BackgroundTasksDialog.tsx` / `runAgent.ts` 门控下接入，`bun run ./scripts/build.ts --dev --feature=MONITOR_TOOL` 打包验证（EXIT:0，5657 modules）；默认构建不含该模块（5653 modules）。
- `REACTIVE_COMPACT`
  ~~Missing `src/services/compact/reactiveCompact.js`.~~ ✅ 已恢复（2026-08-12）：`src/services/compact/reactiveCompact.ts` 完整实现，已在 `query.ts`（`tryReactiveCompact` / `isWithheldPromptTooLong` / `isWithheldMediaSizeError`）与 `commands/compact/compact.ts`（`compactViaReactive` / `isReactiveOnlyMode`）接入，门控为 `feature('REACTIVE_COMPACT')`。
- `REVIEW_ARTIFACT`
  ~~Missing `src/tools/ReviewArtifactTool/ReviewArtifactTool.js`.~~ ✅ 已恢复（2026-08-12）：补全 4 个文件——`tools/ReviewArtifactTool/constants.ts`（`REVIEW_ARTIFACT_TOOL_NAME` / `REVIEW_ARTIFACT_DEFAULT_DIR`）、`tools/ReviewArtifactTool/ReviewArtifactTool.tsx`（buildTool 产出 `ReviewArtifact` 工具，`requiresUserInteraction()`，批准弹窗注入 `selected` finding id，批准后把 artifact 落盘 `.claude/reviews/`）、`components/permissions/ReviewArtifactPermissionRequest/ReviewArtifactPermissionRequest.tsx`（`PermissionDialog` + `SelectMulti` 多选保留/反选 findings）、`skills/bundled/hunter.ts`（hunter 捉虫 skill，驱动审查流程）。已在 `tools.ts` / `PermissionRequest.tsx` / `skills/bundled/index.ts` 门控下接入，`bun run ./scripts/build.ts --dev --feature=REVIEW_ARTIFACT` 打包验证；默认构建不含该模块（DCE 裁掉）。
- `SELF_HOSTED_RUNNER`
  Missing `src/self-hosted-runner/main.js`.
- `SSH_REMOTE`
  Missing `src/ssh/createSSHSession.js`.
  【已放弃 2026-08-14】`claude ssh <host>` 远程机器执行+本地 UI（unix-socket -R 认证隧道回本地）属远程执行方向，本地无需求，不恢复。源码门控（main.tsx `feature('SSH_REMOTE')` + `_pendingSSH`）+ 残留（useSSHSession/sshAuthProxy）保留（编译期 tree-shake）。
- `TERMINAL_PANEL`
  Missing `src/tools/TerminalCaptureTool/TerminalCaptureTool.js`.
- `UDS_INBOX`
  Missing `src/utils/udsMessaging.js` + `src/tools/ListPeersTool/ListPeersTool.js`（`tools.ts` 门控下 require）。
- `WEB_BROWSER_TOOL`
  Missing `src/tools/WebBrowserTool/WebBrowserTool.js`.
- `WORKFLOW_SCRIPTS`
  ~~Missing `src/tools/WorkflowTool/{bundled/index.js, WorkflowTool.js, WorkflowPermissionRequest.js}`（`tools.ts` 门控下 require + `PermissionRequest.tsx`）；`tasks.ts` 还期望 `LocalWorkflowTask`。当前 `WorkflowTool/` 下只有 `constants.ts`。~~ ✅ 已恢复（2026-08-12，单 agent 最小版）：补全 8 个文件——`tools/WorkflowTool/workflowScripts.ts`（扫描 `.claude/workflows/*.md` + frontmatter 解析）、`WorkflowTool.tsx`（buildTool 产出 `Workflow` 工具，`exec()` 解析脚本后 spawn `LocalWorkflowTask` 后台子进程）、`WorkflowPermissionRequest.tsx`、`bundled/index.ts`（`initBundledWorkflows` 先空实现）、`createWorkflowCommand.ts`（`getWorkflowCommands` 把每个脚本注册为 `/name` slash 命令，`kind:'workflow'`）、`tasks/LocalWorkflowTask/LocalWorkflowTask.ts`（`local_workflow` 任务状态 + `kill/skipWorkflowAgent/retryWorkflowAgent`，spawn 子 claude print 进程）、`commands/workflows/{index,workflows}.ts`（`/workflows` 命令）、`components/tasks/WorkflowDetailDialog.tsx`（后台面板详情，s=skip/r=retry/x=kill）。spawn 复用 `exec`+`ShellCommand`（无子 agent 机器依赖）。已在 `tools.ts` / `tasks.ts` / `PermissionRequest.tsx` / `commands.ts` 原有门控下接入；`bun run ./scripts/build.ts --dev --feature=WORKFLOW_SCRIPTS` 打包验证（EXIT:0，5662 modules）；默认构建不含（5653 modules）。⚠️ 子进程 spawn 未运行时实测。⚠️ 2026-08-12 运行时复测发现 `--minify-identifiers` 崩溃：`tools.ts` 原 IIFE（`require bundled/index.js` 调 `initBundledWorkflows()` 后再 `return require WorkflowTool.js`）触发 esbuild 改名 bug（`ReferenceError: returnmO is not defined`，启动即崩，`--version` 正常但交互启动炸）。已改为直接 require（与其它门控工具一致），`initBundledWorkflows()` no-op 挂载点保留注释；`--feature=WORKFLOW_SCRIPTS` 单独及 5-flag 组合（REACTIVE_COMPACT+COORDINATOR_MODE+MONITOR_TOOL+REVIEW_ARTIFACT+WORKFLOW_SCRIPTS）均实测启动 EXIT:0。✅ 2026-08-12 修 cwd 一致：`WorkflowTool.call()` 与 `/workflows` 命令的脚本发现从 `getOriginalCwd()`（启动目录）改为 `getProjectRoot()`（项目身份，bootstrap/state.ts），两处对齐，避免工作树内启动找不到脚本。✅ 2026-08-12 运行时 spawn 实测通过：会话内 Workflow 工具后台任务 `bwbanqdav` 以 exit 0 完成。期间定位并修复 `isInBundledMode()` 对 `--bytecode` exe 的误判——`Bun.embeddedFiles` 对 `--bytecode` 为空数组，旧逻辑（只查 `length>0`）返回 false，使 `cliCommandPrefix()` 误注入 `process.argv[1]`（Bun 虚拟路径 `B:/~BUN/root/cli-dev`）当子 claude 参数 → 报 `too many arguments. Expected 1 argument but got 2.`；`bundledMode.ts` 补 `process.argv[1].includes('/~BUN/')` 分支后垃圾参数消失（影响 bridgeMain/spawnMultiAgent/swarm/ripgrep/imageProcessor/fastMode/main.tsx 等所有 spawn 前缀共用方）。多行 CJK prompt 走 `$(cat '<temp>.md')` 临时文件机制（`buildWorkflowCommand`）保持。✅ 2026-08-12 修子进程落盘污染会话列表：fork 默认持久化会话，`--print` 子进程未传 `--no-session-persistence`（main.tsx:991 注册，要求配 `--print`）→ 每次跑工作流在 `.claude/projects/` 生成一个独立会话 jsonl（实测 9 个，首条=工作流 prompt），污染 `/resume`。修复：`buildWorkflowCommand` spawn 命令加 `'--no-session-persistence'`；重建 EXIT:0（5661 modules）；手动验证新 exe `--print --no-session-persistence` 无新增 jsonl（47→47）。✅ 2026-08-12 会话内端到端确认（WORKFLOW-test4.exe）：跑工作流完成 exit 0，projects/ jsonl 28→28 零新增（旧版同场景会 +1）。

## Broken Flags With Large Missing Subsystems

These are the ones that still look expensive to restore because the first
missing import is only the visible edge of a broader absent subsystem.

- `KAIROS`
  Missing `src/assistant/index.js` and much of the assistant stack with it
  （另有 `tools/SendUserFileTool/SendUserFileTool.js` 等缺失）。
  【已放弃 2026-08-14】官方云端 assistant 模式（需 Anthropic 后端 + 账号，useReplBridge 中 `feature('KAIROS')` 仅控制 perpetual bridge 分支），同 CCR 模式本地不恢复。KAIROS_BRIEF/KAIROS_CHANNELS 为独立部分可用 surface，**保留**。源码门控保留（tree-shake）。
- `KAIROS_DREAM`
  Missing `src/skills/bundled/dream.js`（`skills/bundled/index.ts` 门控下 require）and related dream-task behavior.
  【已放弃 2026-08-14】同 KAIROS 云端 assistant 相关，不恢复。源码门控保留（tree-shake）。
- `PROACTIVE`
  Missing `src/proactive/index.js` + `src/commands/proactive.js` and the proactive task/tool stack.
  【已放弃 2026-08-14】云端主动任务栈（同 KAIROS/CCR 云端方向），本地无需求，不恢复。源码门控保留（tree-shake）。

## Useful Entry Points

- Feature-aware build logic:
  [scripts/build.ts](/Users/paolo/Repos/claude-code/scripts/build.ts)
- Feature-gated command imports:
  [src/commands.ts](/Users/paolo/Repos/claude-code/src/commands.ts)
- Feature-gated tool imports:
  [src/tools.ts](/Users/paolo/Repos/claude-code/src/tools.ts)
- Feature-gated task imports:
  [src/tasks.ts](/Users/paolo/Repos/claude-code/src/tasks.ts)
- Feature-gated query behavior:
  [src/query.ts](/Users/paolo/Repos/claude-code/src/query.ts)
- Feature-gated CLI entry paths:
  [src/entrypoints/cli.tsx](/Users/paolo/Repos/claude-code/src/entrypoints/cli.tsx)
