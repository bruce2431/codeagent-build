/**
 * gatewayToken.ts —— 内置网关 token 的共享访问点（2026-08-15 安全加固）。
 *
 * 安全修复后 HTTP 数据接口（/api/*、/preview/*）与 WS 升级一致要求 token，而 CLI 侧上报
 * （conversationDisplay.ts POST /api/conversation、/api/activity）与 localGateway.ts 同进程。
 * 为避免两模块互相 import 形成循环依赖（localGateway import conversationDisplay 的
 * filterConversationForDisplay），token 存到本小模块，双方各自读写即可。
 *
 * 2026-08-17 网关独立化：token 跨进程落盘。网关进程（同一 exe 的 --gateway 模式）启动时
 * 把 token 写到便携根 `.claude/gateway-token`；其它 CLI 进程（非网关宿主）探测到网关后读盘
 * 获得 token，才能向网关上报 / 连接。内存优先级高于磁盘：本进程自己管理网关时
 * setGatewayToken 写入内存值；否则 getGatewayToken 惰性读盘兜底。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getPortableRoot } from './envUtils.js'

let currentToken = ''
let diskTokenCache = ''
let diskLoaded = false

export function setGatewayToken(token: string): void {
  currentToken = token
}

/** 便携根 .claude/gateway-token 的绝对路径（相对便携根，符合全相对路径红线）。 */
function tokenFilePath(): string {
  return join(getPortableRoot(), '.claude', 'gateway-token')
}

/**
 * 网关进程启动时把 token 写盘，供其它 CLI 进程读取。失败静默（不阻塞网关启动）。
 */
export function saveGatewayTokenToDisk(token: string): void {
  try {
    const p = tokenFilePath()
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, token, { encoding: 'utf8' })
    diskTokenCache = token
    diskLoaded = true
  } catch {
    /* 忽略 */
  }
}

/**
 * 读盘 token（其它 CLI 进程探测到网关后调用）。未落盘返回空串。
 * 结果按文件内容缓存一次；clearGatewayTokenFromDisk 会重置缓存。
 */
export function loadGatewayTokenFromDisk(): string {
  if (diskLoaded) return diskTokenCache
  try {
    const p = tokenFilePath()
    if (existsSync(p)) {
      diskTokenCache = readFileSync(p, 'utf8').trim()
      diskLoaded = true
      return diskTokenCache
    }
  } catch {
    /* 忽略 */
  }
  diskTokenCache = ''
  diskLoaded = true
  return ''
}

/** 网关停止时清盘 token，并重置磁盘缓存。 */
export function clearGatewayTokenFromDisk(): void {
  try {
    rmSync(tokenFilePath(), { force: true })
  } catch {
    /* 忽略 */
  }
  diskTokenCache = ''
  diskLoaded = false
}

/**
 * 当前 token：内存优先（本进程管理网关时由 startLocalGateway 设置），否则读盘兜底。
 * 未启动网关 / 未落盘时返回空串 → 上报方不带 token（保持旧静默失败行为）。
 */
export function getGatewayToken(): string {
  if (currentToken) return currentToken
  return loadGatewayTokenFromDisk()
}
