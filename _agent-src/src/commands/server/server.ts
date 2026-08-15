/**
 * /server 指令实现（内置私有化网关开关）。
 *  on    → 进程内启动内置网关（src/gateway/localGateway.ts，绑定 HOST，token 显式传入并回显 URL）
 *  off   → 停止内置网关；并清理端口上残留的旧独立进程网关（netstat + taskkill）
 *  status→ 探测内置网关状态 + 端口占用
 * 环境变量：GATEWAY_PORT(默认8124)、GATEWAY_HOST(默认0.0.0.0=局域网)、SERVER_TOKEN(指定 token，默认随机)
 */
import { execFileSync } from 'child_process'
import { networkInterfaces } from 'os'
import type { LocalCommandCall } from '../../types/command.js'
import {
  startLocalGateway,
  stopLocalGateway,
  isLocalGatewayRunning,
  getLocalGatewayToken,
} from '../../gateway/localGateway.js'

const PORT = Number(process.env.GATEWAY_PORT || 8124)

function lanAddress(): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address
    }
  }
  return null
}

async function isGatewayUp(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/health`)
    if (!res.ok) return false
    const d = (await res.json()) as { mode?: string }
    return d.mode === 'gateway'
  } catch {
    return false
  }
}

function listeningPids(): string[] {
  try {
    const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' })
    const pids: string[] = []
    for (const line of out.split('\n')) {
      const t = line.trim()
      if (!t.includes(`:${PORT}`) || !t.includes('LISTENING')) continue
      const cols = t.split(/\s+/)
      const pid = cols[cols.length - 1]
      if (pid && /^\d+$/.test(pid) && !pids.includes(pid)) pids.push(pid)
    }
    return pids
  } catch {
    return []
  }
}

function describeUrl(token: string): string {
  const lan = lanAddress()
  const local = `http://127.0.0.1:${PORT}/?token=${token}`
  return lan ? `手机/浏览器访问: http://${lan}:${PORT}/?token=${token}\n本机访问: ${local}` : `访问: ${local}`
}

async function doStatus(): Promise<string> {
  if (isLocalGatewayRunning()) {
    return `内置网关运行中 · ${describeUrl(getLocalGatewayToken())}`
  }
  const pids = listeningPids()
  if (pids.length) {
    const up = await isGatewayUp()
    return up
      ? `端口 ${PORT} 有网关进程 (PID ${pids.join(', ')}) 但非本进程内置网关（旧独立网关残留？用 /server off 清理后 /server on）`
      : `端口 ${PORT} 被进程 ${pids.join(', ')} 占用，但 /api/health 非网关（可能是其它程序）`
  }
  return `内置网关未运行（端口 ${PORT} 空闲）`
}

async function doOn(): Promise<string> {
  if (isLocalGatewayRunning()) {
    return `内置网关已在运行\n${describeUrl(getLocalGatewayToken())}\n停止: /server off`
  }
  // 端口被旧独立网关或其它进程占用：先提示清理，避免 listen 失败后 URL 不可用
  const pids = listeningPids()
  if (pids.length && !(await isGatewayUp())) {
    return `端口 ${PORT} 被进程 ${pids.join(', ')} 占用且非网关，无法启动（先释放端口）`
  }
  const info = startLocalGateway()
  return `内置网关已启动 (本进程内)\n${describeUrl(info.token)}\n停止: /server off`
}

function doOff(): string {
  let out = ''
  if (isLocalGatewayRunning()) {
    stopLocalGateway()
    out = '已停止内置网关'
  }
  // 清理端口上残留的旧独立进程网关（早前 detached 的 gateway.mjs）
  const pids = listeningPids()
  if (pids.length) {
    const killed: string[] = []
    for (const pid of pids) {
      try {
        execFileSync('taskkill', ['/F', '/PID', pid], { stdio: 'pipe' })
        killed.push(pid)
      } catch {
        /* 忽略单个失败 */
      }
    }
    if (killed.length) out += (out ? '\n' : '') + `已清理端口占用进程 (PID ${killed.join(', ')})`
  }
  return out || '网关未运行'
}

export const call: LocalCommandCall = async (args) => {
  const cmd = args.trim().split(/\s+/)[0]?.toLowerCase() || 'status'
  let value: string
  if (cmd === 'on') value = await doOn()
  else if (cmd === 'off') value = doOff()
  else if (cmd === 'status') value = await doStatus()
  else value = `未知参数 "${cmd}"。用法: /server on | off | status`
  return { type: 'text', value }
}
