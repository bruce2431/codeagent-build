/**
 * gatewayClient.ts —— CLI 侧网关客户端（2026-08-17 网关独立化）。
 *
 * 网关现在是独立进程（同一 exe 的 --gateway 模式，/server on spawn）。每个交互式 CLI
 * 进程（非网关宿主）启动后由本模块：
 *  1. 探测本机网关（GET /api/health，地址 = FLOIRA_GATEWAY 或回退 127.0.0.1:8124）；
 *     网关未起则后台定时重试（网关后起也能连上），全程静默不打扰；
 *  2. 读盘 token（网关进程启动时写入便携根 .claude/gateway-token）→ setGatewayToken，
 *     让 conversationDisplay 的 HTTP 上报（/api/conversation、/api/activity）也带 token；
 *  3. 以 WebSocket 客户端连 /clients?token=&session=<getSessionId()> 注册自己的会话；
 *  4. 收到网关转发来的遥测端消息（{type:'send', text}）→ enqueue 注入本进程 REPL
 *     （与打字同路径，复用 messageQueueManager.enqueue + bridgeOrigin:true）。
 *
 * 断线指数退避重连。headless（print.ts）不挂载本模块：它只上报、不交互，无 REPL 可注入。
 */
import WebSocket from 'ws'
import { getSessionId } from '../bootstrap/state.js'
import { invokeControlOverride } from '../bridge/controlOverrideHandle.js'
import { enqueue } from './messageQueueManager.js'
import { loadGatewayTokenFromDisk, setGatewayToken } from './gatewayToken.js'
import type { QueuedCommand } from '../types/textInputTypes.js'

const HEALTH_TIMEOUT_MS = 1500
const PROBE_RETRY_MS = 10_000
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 60_000

/** 网关 HTTP 基地址（对齐 conversationDisplay.ts：FLOIRA_GATEWAY 优先，回退本地 8124）。 */
function baseUrl(): string {
  return (process.env.FLOIRA_GATEWAY || 'http://127.0.0.1:8124').replace(/\/+$/, '')
}

function wsHostPort(): { host: string; port: number } {
  try {
    const u = new URL(baseUrl())
    return { host: u.hostname, port: Number(u.port || 8124) }
  } catch {
    return { host: '127.0.0.1', port: 8124 }
  }
}

let started = false
let ws: WebSocket | null = null
let timer: NodeJS.Timeout | null = null
let attempt = 0

async function isGatewayUp(): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl()}/api/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) })
    if (!res.ok) return false
    const d = (await res.json()) as { mode?: string }
    return d.mode === 'gateway'
  } catch {
    return false
  }
}

/** 探测网关 → 读盘 token → 连 /clients。网关未起则定时重试（gateway 后起也能连上）。 */
async function probeAndConnect(): Promise<void> {
  if (ws) return
  if (!(await isGatewayUp())) {
    schedule(PROBE_RETRY_MS)
    return
  }
  const token = loadGatewayTokenFromDisk()
  if (!token) {
    // 网关起来了但 token 尚未落盘（瞬态）：稍后再试
    schedule(PROBE_RETRY_MS)
    return
  }
  // 让本进程的 HTTP 上报也带 token（否则非网关宿主的 CLI 上报会被 401）
  setGatewayToken(token)
  openSocket(token)
}

function openSocket(token: string): void {
  const { host, port } = wsHostPort()
  const sid = getSessionId()
  const url = `ws://${host}:${port}/clients?token=${encodeURIComponent(token)}&session=${encodeURIComponent(sid)}`
  let sock: WebSocket
  try {
    sock = new WebSocket(url)
  } catch {
    schedule(RECONNECT_BASE_MS)
    return
  }
  ws = sock
  sock.on('open', () => {
    attempt = 0
  })
  sock.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString()) as { type?: string; text?: string; value?: unknown }
      // 2026-08-22 模型/思考等级控制消息：网关 POST /api/model 后广播给在线 CLI，
      // 走 controlOverrideHandle → REPL 侧 setAppState（与官方 useReplBridge.onSetModel 同语义）。
      if (msg.type === 'model' || msg.type === 'effort') {
        invokeControlOverride(msg.type, msg.value)
        return
      }
      if (msg.type === 'send' && typeof msg.text === 'string' && msg.text.trim()) {
        enqueue({ value: msg.text, mode: 'prompt', skipSlashCommands: true, bridgeOrigin: true } as QueuedCommand)
      }
    } catch {
      /* 忽略坏帧 */
    }
  })
  sock.on('close', () => {
    if (ws === sock) {
      ws = null
      schedule(reconnectDelay())
    }
  })
  sock.on('error', () => {
    /* error 后必跟 close，重连交给 close */
  })
}

function reconnectDelay(): number {
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS)
  attempt++
  return delay
}

function schedule(ms: number): void {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    void probeAndConnect()
  }, ms)
}

/**
 * 启动网关探测 + 客户端连接（幂等单例）。在交互 REPL 新会话启动点 fire-and-forget 调用。
 */
export function startGatewayProbeAndConnect(): void {
  if (started) return
  started = true
  void probeAndConnect()
}

/**
 * sessionId 变化时刷新注册（如 REPL 开启新会话 / 切换会话）。关闭旧连接后重新探测连接，
 * 保证网关注册表里的 session 与当前会话一致。
 */
export function refreshGatewayRegistration(): void {
  if (ws) {
    try {
      ws.close()
    } catch {
      /* 忽略 */
    }
    ws = null
  }
  attempt = 0
  void probeAndConnect()
}
