import type { Command } from '../../commands.js'

/**
 * /server — 内置私有化网关开关指令（进程内，无独立进程）。
 * 由 PRIVATE_GATEWAY feature flag 门控（2026-08-25 起默认开，见 FEATURES.md）；flag 关闭时整个模块被 tree-shake，命令不存在。
 */
export default {
  type: 'local',
  name: 'server',
  description: 'Start/stop/status the built-in private gateway (LAN remote control)',
  supportsNonInteractive: true,
  load: () => import('./server.js'),
} satisfies Command
