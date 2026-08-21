/**
 * /server 指令实现（内置私有化网关开关）。
 * 2026-08-17 网关独立化：网关以「同一 exe 的 --gateway 模式」作为独立进程运行（/server on
 * detached spawn 自身 exe），父 CLI 退出不影响网关；任何 CLI 进程均可连接共用（token 落盘
 * 便携根 .claude/gateway-token，各进程读盘共享）。
 *  on    → spawn 独立网关进程（--gateway，detached + unref），绑定 HOST，等待端口就绪并回显 URL
 *  off   → POST /api/shutdown 优雅关闭独立网关；兜底 netstat + taskkill 清理端口残留
 *  status→ 端口探测网关状态
 * 空闲回收：网关三集合全空持续 GATEWAY_IDLE_MINUTES(默认10) 分钟自动关闭（见 localGateway.ts）
 * 环境变量：GATEWAY_PORT(默认8124)、GATEWAY_HOST(默认0.0.0.0=局域网)、SERVER_TOKEN(指定 token，默认随机)、GATEWAY_IDLE_MINUTES(空闲回收阈值分钟)
 */
import { spawnSync, spawn } from 'child_process'
import { randomBytes } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import type { LocalCommandCall } from '../../types/command.js'
import { loadGatewayTokenFromDisk } from '../../utils/gatewayToken.js'

const PORT = Number(process.env.GATEWAY_PORT || 8124)

function lanAddress(): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address
    }
  }
  return null
}

async function isGatewayUp(port: number = PORT): Promise<boolean> {
  try {
    // 必须带超时：若端口被幽灵进程占用（TCP 可连但 HTTP 永不回），无超时的 fetch 会让 /server status|on 永久卡死
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return false
    const d = (await res.json()) as { mode?: string }
    return d.mode === 'gateway'
  } catch {
    return false
  }
}

function listeningPids(port: number = PORT): string[] {
  try {
    // 2026-08-20 黑框根治第2轮：execFileSync 的 windowsHide 在 bun 运行时无效（/server off 仍弹窗），
    // 改 spawnSync（与已验证生效的 spawn 同一实现），netstat 读 stdout
    const res = spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true })
    const out = res.stdout ?? ''
    const pids: string[] = []
    for (const line of out.split('\n')) {
      const t = line.trim()
      if (!t.includes(`:${port}`) || !t.includes('LISTENING')) continue
      const cols = t.split(/\s+/)
      const pid = cols[cols.length - 1]
      if (pid && /^\d+$/.test(pid) && !pids.includes(pid)) pids.push(pid)
    }
    return pids
  } catch {
    return []
  }
}

function describeUrl(token: string, port: number = PORT): string {
  const lan = lanAddress()
  const local = `http://127.0.0.1:${port}/?token=${token}`
  return lan ? `手机/浏览器访问: http://${lan}:${port}/?token=${token}\n本机访问: ${local}` : `访问: ${local}`
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// 探测实际网关端口：默认 PORT，可能因端口占用被自动顺延换端口
async function findGatewayPort(): Promise<number | null> {
  for (let p = PORT; p < PORT + 6; p++) {
    if (await isGatewayUp(p)) return p
  }
  return null
}

async function doStatus(): Promise<string> {
  const gwPort = await findGatewayPort()
  if (gwPort !== null) {
    const token = loadGatewayTokenFromDisk()
    return `内置网关运行中（独立进程） · ${describeUrl(token, gwPort)}`
  }
  const pids = listeningPids(PORT)
  if (pids.length) {
    return `端口 ${PORT} 被进程 ${pids.join(', ')} 占用，但 /api/health 非网关（可能是其它程序）`
  }
  return `内置网关未运行（端口 ${PORT} 空闲）`
}

async function doOn(): Promise<string> {
  if (await isGatewayUp()) {
    const token = loadGatewayTokenFromDisk()
    return `内置网关已在运行（独立进程）\n${describeUrl(token, PORT)}\n停止: /server off`
  }
  // 端口被占用时自动清理：能杀则 taskkill 释放；杀不掉（幽灵 socket 残留，进程表查不到）则自动顺延换端口，
  // 保证每次 /server on 都能把网关起起来，不再卡在「端口被占用」手动处理上
  let target = PORT
  const notes: string[] = []
  for (let attempt = 0; attempt < 6; attempt++) {
    const pids = listeningPids(target)
    if (!pids.length) break
    if (await isGatewayUp(target)) {
      return `端口 ${target} 已有网关进程 (PID ${pids.join(', ')})`
    }
    const killed: string[] = []
    const failed: string[] = []
    for (const pid of pids) {
      try {
        spawnSync('taskkill', ['/F', '/PID', pid], { stdio: 'ignore', windowsHide: true })
        killed.push(pid)
      } catch {
        failed.push(pid)
      }
    }
    await sleep(400)
    if (!listeningPids(target).length) {
      if (killed.length) notes.push(`已自动清理端口 ${target} 占用进程 (PID ${killed.join(', ')})`)
      break
    }
    notes.push(
      `端口 ${target} 被占用且自动清理失败${failed.length ? ` (PID ${failed.join(', ')} 无法终止，疑内核 socket 残留)` : ''}，已改用端口 ${target + 1}`
    )
    target++
  }
  // 2026-08-17 独立化：detached spawn 自身 exe（--gateway 模式），父 CLI 退出不影响网关。
  // token 显式传入子进程（用户设了 SERVER_TOKEN 则沿用，否则随机），网关启动时写盘共享。
  const token = process.env.SERVER_TOKEN || randomBytes(16).toString('hex')
  const child = spawn(process.execPath, ['--gateway'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true, // 2026-08-20 黑框根因修复：exe 是 console 子系统，不加会在 spawn 网关进程时弹命令行窗口
    env: {
      ...process.env,
      GATEWAY_PORT: String(target),
      GATEWAY_HOST: '0.0.0.0',
      SERVER_TOKEN: token,
    },
  })
  child.unref()
  // 等待端口就绪（最多 ~6s）
  let up = false
  for (let i = 0; i < 30; i++) {
    await sleep(200)
    if (await isGatewayUp(target)) {
      up = true
      break
    }
  }
  if (!up) {
    return `网关进程已 spawn (PID ${child.pid})，但端口 ${target} 未就绪，稍后用 /server status 查看${notes.length ? `\n${notes.join('\n')}` : ''}`
  }
  const note = notes.length ? `\n${notes.join('\n')}` : ''
  const idleMin = Number(process.env.GATEWAY_IDLE_MINUTES || 10)
  return `内置网关已启动（独立进程，PID ${child.pid}）${note}\n${describeUrl(token, target)}\n停止: /server off\n空闲 ${idleMin} 分钟无连接将自动关闭`
}

async function doOff(): Promise<string> {
  let out = ''
  // 探测实际网关端口（可能被自动换端口），否则 shutdown/taskkill 会打错端口
  const gwPort = await findGatewayPort()
  // 优雅关闭独立网关：POST /api/shutdown（带 token，受网关 token 校验保护）
  const token = loadGatewayTokenFromDisk()
  if (token && gwPort !== null) {
    try {
      await fetch(`http://127.0.0.1:${gwPort}/api/shutdown?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        signal: AbortSignal.timeout(1500),
      })
      await sleep(300)
      out = `已发送网关关闭指令（端口 ${gwPort}）`
    } catch {
      /* 网络异常则走 taskkill 兜底 */
    }
  }
  // 兜底：清理端口上残留的占用进程
  const pids = listeningPids(gwPort ?? PORT)
  if (pids.length) {
    const killed: string[] = []
    for (const pid of pids) {
      try {
        spawnSync('taskkill', ['/F', '/PID', pid], { stdio: 'ignore', windowsHide: true })
        killed.push(pid)
      } catch {
        /* 忽略单个失败 */
      }
    }
    if (killed.length) out += (out ? '\n' : '') + `已清理端口占用进程 (PID ${killed.join(', ')})`
  }
  if (out) return out
  return (await isGatewayUp(gwPort ?? PORT)) ? '网关未停止（关闭失败，可再试 /server off）' : '网关未运行'
}

export const call: LocalCommandCall = async (args) => {
  const cmd = args.trim().split(/\s+/)[0]?.toLowerCase() || 'status'
  let value: string
  if (cmd === 'on') value = await doOn()
  else if (cmd === 'off') value = await doOff()
  else if (cmd === 'status') value = await doStatus()
  else value = `未知参数 "${cmd}"。用法: /server on | off | status`
  return { type: 'text', value }
}
