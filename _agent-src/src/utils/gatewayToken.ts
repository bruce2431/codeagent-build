/**
 * gatewayToken.ts —— 内置网关 token 的进程内共享访问点（2026-08-15 安全加固）。
 *
 * 安全修复后 HTTP 数据接口（/api/*、/preview/*）与 WS 升级一致要求 token，而 CLI 侧上报
 * （conversationDisplay.ts POST /api/conversation、/api/activity）与 localGateway.ts 同进程。
 * 为避免两模块互相 import 形成循环依赖（localGateway import conversationDisplay 的
 * filterConversationForDisplay），token 存到本小模块，双方各自读写即可。
 *
 * 生命周期由 localGateway 维护：startLocalGateway 设置，stopLocalGateway 清空。
 * 未启动网关时 getGatewayToken() 返回空串 → 上报方不带 token（保持旧的静默失败行为）。
 */
let currentToken = ''

export function setGatewayToken(token: string): void {
  currentToken = token
}

export function getGatewayToken(): string {
  return currentToken
}
