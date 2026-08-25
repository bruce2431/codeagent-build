/**
 * localGateway.ts —— 内置私有化网关（feature: PRIVATE_GATEWAY）。
 *
 * 2026-08-17 网关独立化：网关以「同一 exe 的 --gateway 模式」作为独立进程运行（/server on
 * detached spawn 自身 exe），本模块即该网关进程的主体。CLI 进程（非网关宿主）启动后作为
 * WS 客户端连 /clients 注册自己的 sessionId（见 src/utils/gatewayClient.ts）；遥测端（浏览器）
 * 经 /ws 发消息，网关按 sessionId 跨进程路由转发给对应 CLI，由 CLI 侧 enqueue 注入其 REPL
 * （与打字同路径）。token 落盘便携根 .claude/gateway-token，供各 CLI 进程读取后上报/连接。
 *
 * 生命周期（2026-08-17）：网关以独立进程长驻，不随任何 CLI 退出而消失；「无客户端空闲自动回收」
 * ——CLI 注册(cliClients)/遥测 WS(sockets)/SSE(sseClients) 三集合全空持续 GATEWAY_IDLE_MINUTES
 * （默认 10，可用环境变量调）分钟后自动 stopLocalGateway + 清盘 token + 退出，避免孤儿网关占端口。
 * 停止途径：/server off（POST /api/shutdown）、空闲自动回收、SIGINT/SIGTERM、taskkill、系统关机。
 *
 * 复用已有实现：
 *  - 会话展示由 CLI 侧 conversationDisplay.ts 导出（POST /api/conversation），/api/session
 *    命中时优先返回 display；此处 jsonl 兜底读取仅用于 CLI 未导出的情况。
 *  - 注入路径与 useReplBridge.handleInboundMessage 相同：enqueue({mode:'prompt', bridgeOrigin:true})
 *    —— 现在在 CLI 进程（gatewayClient）内执行，而非本网关进程。
 *
 * HTTP/WS 用 node:http + ws（已验证可打包进 bun 编译产物），不依赖 Bun.serve。
 */
import { createServer, type Server } from 'node:http'
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync, openSync, closeSync, truncateSync, appendFileSync, watch, type FSWatcher } from 'node:fs'
import { open as fsOpen } from 'node:fs/promises'
import { join, resolve, extname, basename, sep, isAbsolute } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import type { UUID } from 'crypto'
import { networkInterfaces } from 'node:os'
import { createServer as netCreateServer, createConnection as netCreateConnection } from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { WebSocketServer, WebSocket } from 'ws'
import { getPortableRoot } from '../utils/envUtils.js'
import { getProjectRoot } from '../bootstrap/state.js'
import {
  extractJsonStringField,
  extractLastJsonStringField,
  readSessionLite,
} from '../utils/sessionStoragePortable.js'
import { parseSessionInfoFromLite } from '../utils/listSessionsImpl.js'
import { filterConversationForDisplay } from '../utils/conversationDisplay.js'
import { setGatewayToken, saveGatewayTokenToDisk, clearGatewayTokenFromDisk } from '../utils/gatewayToken.js'
// 复用官方凭据池：模型校验与 CLI 同一来源（credentials.json activeProvider.models），
// 每会话切换不写全局凭据池（不 switchModel）；getActiveModel 与 CLI getUserSpecifiedModelSetting 同源。
// 设为默认模型 = switchModel 写凭据池 activeModel（全局默认，2026-08-23）。
import { getActiveModel, getActiveProviderConfig, switchModel } from '../utils/credentials/pool.js'
// 上下文占用（dsh ContextMeter 数据源）：复用 auto-compact 同源的模型上下文窗口解析，不本地复刻。
import { getContextWindowForModel } from '../utils/context.js'
// 会话重命名（2026-08-24 修复）：直接复用 CLI /rename 的落盘函数（saveCustomTitle + saveAgentName），
// 不本地复刻写盘格式——与 CLI 完全同路径，保证含 sessionId、CLI resume 能读到、退出不回退。
import { saveAgentName, saveCustomTitle } from '../utils/sessionStorage.js'
import { webAssets } from './web-assets.generated.js'

// ============================================================================
// 状态
// ============================================================================
let server: Server | null = null
let wss: WebSocketServer | null = null
let currentToken = ''
let currentHost = '0.0.0.0'
let currentPort = 8124
const sockets = new Set<WebSocket>()
// 2026-08-17 网关独立化：CLI 进程（非网关宿主）作为 WS 客户端连 /clients 注册自己的
// sessionId。遥测端发消息时网关按 sessionId 路由转发给对应 CLI，由 CLI 注入其 REPL。
const cliClients = new Map<string, WebSocket>()
const sseClients = new Set<{ res: import('node:http').ServerResponse }>()
let ssePrimed = false
const sseSizes = new Map<string, { size: number; mtime: number }>()
// O4：SSE 事件驱动 —— 用 fs.watch 监听各项目会话目录，替代 2s 轮询。sseWatches 持所有 watcher，
// sseDebounce 合并同一波文件写入的多个 change/rename 事件（250ms 去抖），避免频繁扫描。
const sseWatches = new Set<FSWatcher>()
let sseDebounce: NodeJS.Timeout | null = null
// 2026-08-17 空闲自动回收：三集合（cliClients/sockets/sseClients）全空持续 GATEWAY_IDLE_MINUTES
// 分钟后自动关闭网关，避免「所有 CLI/遥测端都退出、网关空转占端口」的孤儿状态。仅 --gateway
// 独立进程模式启用（进程内模式网关随 CLI 同生共死，无孤儿问题）。阈值可用 GATEWAY_IDLE_MINUTES 调。
const GATEWAY_IDLE_MINUTES = Number(process.env.GATEWAY_IDLE_MINUTES || 10)
const ENABLE_IDLE_RECLAIM = process.argv.includes('--gateway')
let idleTimer: NodeJS.Timeout | null = null

// ============================================================================
// Web 容器 backend 进程管理（2026-08-19）
// preview.json 声明 backend 的项目 → 网关懒加载 spawn 后端进程 + 动态端口分配，
// 前端 iframe 直连 http://127.0.0.1:<port>/。生命周期：网关 stop 时全部 kill、
// 空闲回收（复用 GATEWAY_IDLE_MINUTES 阈值）、后端异常退出自动清理记录。
// ============================================================================
interface BackendCfg {
  name?: string // 显示名（前端启动覆盖层提示用），缺省 = 项目 label；可插拔：任意后端在 preview.json 声明
  cmd: string[] // 命令数组，{port} 占位符在 spawn 时替换为实际分配端口
  cwd?: string // 工作目录，缺省 = 该项目 .claude/preview 目录
  port: number // 0 = 动态分配（网关从 8130 起探测顺延）
  idleMinutes?: number // 空闲回收阈值，缺省继承 GATEWAY_IDLE_MINUTES
  readyPath?: string // 就绪探测路径，缺省 /api/system_stats
}
interface BackendProc {
  pid: number
  port: number
  cfg: BackendCfg
  startedAt: number
  lastActive: number // 最近一次活跃（/api/backend 被调用/就绪探测），用于空闲回收
  child: import('node:child_process').ChildProcess
}
const backendProcesses = new Map<string, BackendProc>()
const BACKEND_PORT_BASE = 8130
const BACKEND_PORT_MAX = 8160
let backendReclaimTimer: NodeJS.Timeout | null = null
// 网关正在停止标志（O1 修复）：/server off → stopLocalGateway 置位，doSpawnBackend 就绪探测
// 循环据此提前退出并 kill 已 spawn 的子进程，避免「探测期网关停止 → 孤儿后端进程」竞态。
let gatewayStopping = false

// ============================================================================
// Web 独立会话（2026-08-23 遥测端会话与 CLI 等权）
// 每个 web 独立会话 = 网关 spawn 一个 cli-dev exe headless 子进程
// （-p --verbose --input-format stream-json --output-format stream-json），
// 复用同一 CLI 会话引擎/工具/权限/落盘格式，天然与 CLI 等权、真并行（独立进程，
// CLI 主进程退出不影响 web 会话）。web 消息经子进程 stdin 喂入，stdout NDJSON
// 逐行转发给订阅该会话的遥测端 WS；can_use_tool 审批请求转 approval 卡片。
// ============================================================================
interface WebSessionProc {
  sessionId: string
  child: import('node:child_process').ChildProcess
  /** 真实 CLI 进程 pid（Start-Process -PassThru 输出；powershell 中转已退出，stopWebSession 用它 taskkill） */
  pid?: number
  clients: Set<WebSocket>
  startedAt: number
  lastActive: number // 最近活跃（消息/审批），用于空闲回收
}
const webSessions = new Map<string, WebSessionProc>()
let webReclaimTimer: NodeJS.Timeout | null = null
// web 会话 id 注册表（持久化到便携根 .claude/web-sessions.json）：用于 listSessions 标记
// kind:'web'（进程停止后磁盘扫描仍能识别哪些会话是 web 端创建的）。
// 2026-08-24 扩展 projects 映射 {sid → 项目 label}：web 会话可在指定项目下新建
// （spawn cwd = 项目根），resume 时按注册的项目定位 cwd；旧格式（仅 ids）兼容。
function webSessionsRegistryPath(): string {
  return join(getPortableRoot(), '.claude', 'web-sessions.json')
}
function loadWebSessionRegistry(): { ids: Set<string>; projects: Record<string, string> } {
  try {
    const d = JSON.parse(readFileSync(webSessionsRegistryPath(), 'utf8')) as { ids?: unknown; projects?: unknown }
    const ids = new Set(Array.isArray(d.ids) ? d.ids.map(String) : [])
    const projects: Record<string, string> = {}
    if (d.projects && typeof d.projects === 'object') {
      for (const [k, v] of Object.entries(d.projects)) if (typeof v === 'string') projects[k] = v
    }
    return { ids, projects }
  } catch {
    /* 无注册表 → 空 */
  }
  return { ids: new Set(), projects: {} }
}
function saveWebSessionRegistry(ids: Set<string>, projects: Record<string, string>): void {
  try {
    const p = webSessionsRegistryPath()
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, JSON.stringify({ ids: [...ids], projects }), 'utf8')
  } catch {
    /* 忽略 */
  }
}
// web 会话启动 cwd（2026-08-24 用户定案：笔=全局根，项目=项目目录内）：
//  CLI 的 getProjectRoot() = 进程启动时的 cwd（state.ts getInitialState projectRoot: resolvedCwd），
//  会话 jsonl 自然落 <cwd>/.claude/projects/——所以只需把 cwd 指对，落盘位置即正确，无需额外落盘逻辑。
//  - project 指定（findProjects 命中的项目组，防任意路径）→ 该项目根目录
//  - 未指定（笔/首页消息发送）→ 全局根（便携根 getPortableRoot() = @WrokSpace 散装对话区）
function webSessionProjectRoot(project: string | undefined): string {
  if (project && project.trim()) {
    const g = findProjects(getPortableRoot()).find((x) => x.scope === 'project' && x.label === project)
    if (g) return resolve(g.dir, '..', '..') // dir = <项目根>/.claude/projects → 上两级 = 项目根
  }
  return getPortableRoot()
}

// web 会话 exe 定位（2026-08-24 用户定案）：
//  - project 指定（项目 label）→ 该项目根下找 cli-dev*.exe（带时间戳的 PRIVATE_GATEWAY 版本优先，取时间戳最大）
//    例：Pj14 → @WrokSpace\Pj14-AI动画制作\cli-dev-20260816212109-PRIVATE_GATEWAY.exe
//  - 未指定（笔/首页消息发送）→ 全局根（便携根 getPortableRoot()）下找 cli-dev*.exe
//    例：@WrokSpace\cli-dev-20260820192634-PRIVATE_GATEWAY.exe
//  - 找不到 → 回退网关自身 exe（process.execPath）
function webSessionExe(project: string | undefined): string {
  const candidates: string[] = []
  if (project && project.trim()) {
    const g = findProjects(getPortableRoot()).find((x) => x.scope === 'project' && x.label === project)
    if (g) candidates.push(resolve(g.dir, '..', '..'))
  } else {
    candidates.push(getPortableRoot())
  }
  for (const dir of candidates) {
    let files: string[] = []
    try {
      files = readdirSync(dir).filter((f) => /^cli-dev.*\.exe$/i.test(f))
    } catch {
      continue
    }
    if (!files.length) continue
    // 带时间戳的 PRIVATE_GATEWAY 版本优先（按名称排序取最大时间戳）；否则任意 cli-dev*.exe
    const stamped = files.filter((f) => /cli-dev-\d{14}-PRIVATE_GATEWAY\.exe/i.test(f)).sort().pop()
    const chosen = stamped ?? files[0]
    return join(dir, chosen)
  }
  return process.execPath
}

// CLI 侧 conversationDisplay.ts 上报的展示结果（内存，进程退出即消失）
const conversationDisplays = new Map<string, { messages: unknown[]; updatedAt: number }>()
// CLI 侧 sendSessionActivity 上报的活动状态（内存，进程退出即消失）
const sessionActivity = new Map<string, { status: string; pid: number; cwd?: string; updatedAt: number }>()
// 2026-08-24 模型 web/CLI 同步：CLI 侧 reportCurrentModel 上报的每会话实际模型（内存，进程退出即消失）。
// 每会话模型 override 只存在于 CLI 进程内存，web 端 /api/session 据此读取校准模型 seat。
const sessionModels = new Map<string, { model: string; updatedAt: number }>()
// C1 修复：两个内存 Map 无上限（只增不删）→ 长跑泄漏。加 TTL + 死进程惰性清扫。
const DISPLAY_TTL_MS = 10 * 60 * 1000 // conversationDisplays 10 分钟无刷新视为过期
const ACTIVITY_TTL_MS = 10 * 60 * 1000 // sessionActivity 10 分钟无上报视为过期
const SESSION_MODEL_TTL_MS = 10 * 60 * 1000 // sessionModels 10 分钟无上报视为过期
const MAX_REPORT_BODY_BYTES = 1024 * 1024

// ============================================================================
// 小工具
// ============================================================================
const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function isPathInside(parent: string, candidate: string): boolean {
  return candidate === parent || candidate.startsWith(parent + sep)
}

class ReportBodyTooLargeError extends Error {}

async function readReportBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += part.length
    if (size > MAX_REPORT_BODY_BYTES) throw new ReportBodyTooLargeError()
    chunks.push(part)
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('request body must be a JSON object')
  }
  return parsed as Record<string, unknown>
}
function lanAddress(): string | null {
  const addrs: string[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) addrs.push(ni.address)
    }
  }
  // 优先真实私有局域网网段，跳过 VPN/代理虚拟网卡（198.18.x benchmark 段、Tailscale 100.x 等）
  const pick = (re: RegExp) => addrs.find((a) => re.test(a))
  return (
    pick(/^192\.168\./) ||
    pick(/^10\./) ||
    pick(/^172\.(1[6-9]|2\d|3[01])\./) ||
    addrs[0] ||
    null
  )
}

// 静态资源根：SubPj1 前端优先，SubPj2 本地 public 兜底。
// SubPj 是当前项目的子项目（Pj16-CodeAgent构建/SubPj1-遥测网页/...），故项目根优先；
// 便携根兜底兼容旧假设（2026-08-14 修：原只按便携根 @WrokSpace 定位，SubPj1 在项目根内导致磁盘兜底恒 404）。
function publicDir(root: string): string {
  const bases = [getProjectRoot(), root]
  for (const base of bases) {
    const subPj1 = join(base, 'SubPj1-遥测网页', 'public')
    if (isDir(subPj1)) return subPj1
  }
  for (const base of bases) {
    const subPj2 = join(base, 'SubPj2-私有化网关', 'public')
    if (isDir(subPj2)) return subPj2
  }
  return join(root, 'SubPj1-遥测网页', 'public')
}

// 内嵌 web 资源（打包进 exe，gen-web-assets.ts 生成）；命中则内存 serve，磁盘 SubPj public 仅作开发兜底。
// base64 解码结果惰性缓存，避免每次静态请求重复解码 index.html/app.js 等常驻资源。
const webAssetCache = new Map<string, Buffer>()
function readWebAsset(name: string): Buffer | null {
  const cached = webAssetCache.get(name)
  if (cached) return cached
  const b64 = webAssets[name]
  if (b64 === undefined) return null
  try {
    const buf = Buffer.from(b64, 'base64')
    webAssetCache.set(name, buf)
    return buf
  } catch {
    return null
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.canvas': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

// ============================================================================
// 会话列表 / 读取（基于便携根扫描；逻辑对齐旧 gateway.mjs）
// ============================================================================
const SESSION_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i

interface ProjectInfo {
  label: string
  dir: string
  scope: string
  hasPreview: boolean
  hasBackend?: boolean
  backendCfg?: BackendCfg
}

function findProjects(root: string): ProjectInfo[] {
  const groups: ProjectInfo[] = []
  const global = join(root, '.claude', 'projects')
  if (isDir(global)) groups.push({ label: '全局根 · 散装对话', dir: global, scope: 'global', hasPreview: false })
  let entries: Array<{ name: string; isDirectory: () => boolean }> = []
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return groups
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    if (e.name.startsWith('.')) continue
    if (/^\d{8,14}-/.test(e.name)) continue // 根级临时任务目录
    const pd = join(root, e.name, '.claude', 'projects')
    if (isDir(pd)) {
      // hasPreview：项目自带 .claude/preview/（网页渲染，点击项目胶囊时前端 iframe 加载替换界面）
      const previewDir = join(root, e.name, '.claude', 'preview')
      const info: ProjectInfo = { label: e.name, dir: pd, scope: 'project', hasPreview: isDir(previewDir) }
      // hasBackend：preview.json 声明 backend → 该项目预览以「Web 容器」方式运行（网关 spawn 后端进程，iframe 直连）
      if (info.hasPreview) {
        const cfg = readBackendCfg(previewDir)
        if (cfg) {
          info.hasBackend = true
          info.backendCfg = cfg
        }
      }
      groups.push(info)
    }
  }
  return groups
}

// 读 <previewDir>/preview.json 的 backend 声明；不存在或结构非法 → undefined
function readBackendCfg(previewDir: string): BackendCfg | undefined {
  const pj = join(previewDir, 'preview.json')
  if (!existsSync(pj)) return undefined
  try {
    const raw = JSON.parse(readFileSync(pj, 'utf-8')) as {
      backend?: { name?: unknown; cmd?: unknown; cwd?: string; port?: number; idleMinutes?: number; readyPath?: string }
    }
    const b = raw?.backend
    if (!b || !Array.isArray(b.cmd) || !b.cmd.length) return undefined
    return {
      name: typeof b.name === 'string' && b.name ? b.name : undefined,
      cmd: b.cmd.map(String),
      // cwd 相对 preview.json 所在目录解析（如 "../../comfyui-backend" → 项目根下 comfyui-backend），
      // 缺省 = preview 目录本身
      cwd: typeof b.cwd === 'string' && b.cwd ? resolve(previewDir, b.cwd) : previewDir,
      port: typeof b.port === 'number' ? b.port : 0,
      idleMinutes: typeof b.idleMinutes === 'number' ? b.idleMinutes : GATEWAY_IDLE_MINUTES,
      readyPath: typeof b.readyPath === 'string' && b.readyPath ? b.readyPath : '/api/system_stats',
    }
  } catch {
    return undefined
  }
}

function countUserAssistant(text: string): number {
  let n = 0
  for (const line of text.split('\n')) {
    if (line.includes('"type":"user"') || line.includes('"type":"assistant"')) n++
  }
  return n
}

type SessionMeta = { sidechain: true } | { title: string; messageCount: number; updatedAt: number }

// 大文件兜底：head/tail 64KB 窗口可能不含最后一条 custom-title（CLI 进程未正常退出
// 或最后一次 rename 后又追加大量消息，re-append 保证失效）。反向分块扫描文件，
// 找最后一条 {"type":"custom-title",...} 记录。命中即返回；未命中至多反向扫一遍。
const CUSTOM_TITLE_MARKER = '"type":"custom-title"'
async function findLastCustomTitle(file: string): Promise<string | undefined> {
  const CHUNK = 512 * 1024
  const OVERLAP = 64 * 1024
  const fh = await fsOpen(file, 'r')
  try {
    const { size } = await fh.stat()
    let end = size
    while (end > 0) {
      const start = Math.max(0, end - CHUNK)
      const len = end - start
      const buf = Buffer.allocUnsafe(len)
      const { bytesRead } = await fh.read(buf, 0, len, start)
      const chunk = buf.toString('utf8', 0, bytesRead)
      let idx = chunk.lastIndexOf(CUSTOM_TITLE_MARKER)
      while (idx >= 0) {
        const lineStart = chunk.lastIndexOf('\n', idx - 1) + 1
        const lineEnd = chunk.indexOf('\n', idx)
        const line = lineEnd >= 0 ? chunk.slice(lineStart, lineEnd) : chunk.slice(lineStart)
        // 只认真正的 custom-title 记录行（避免消息内容里恰好出现的相似文本）
        if (!line.trimStart().startsWith('{"type":"custom-title"')) {
          idx = chunk.lastIndexOf(CUSTOM_TITLE_MARKER, idx - 1)
          continue
        }
        const t = extractLastJsonStringField(line, 'customTitle')
        if (t) return t
        idx = chunk.lastIndexOf(CUSTOM_TITLE_MARKER, idx - 1)
      }
      // 重叠向前推进，避免记录跨块边界被切漏
      end = start + OVERLAP
    }
    return undefined
  } finally {
    await fh.close()
  }
}

async function parseMeta(file: string): Promise<SessionMeta | null> {
  const lite = await readSessionLite(file)
  if (!lite) return null
  const { head, tail, mtime } = lite
  if (head.includes('"isSidechain":true') || head.includes('"isSidechain": true')) return { sidechain: true }
  const teamName = extractJsonStringField(head, 'teamName')
  if (teamName) return { sidechain: true }
  const messageCount =
    countUserAssistant(head) + (tail === head ? 0 : countUserAssistant(tail))
  const uuid = basename(file).replace(/\.jsonl$/, '')
  // 复用 CLI 权威标题提取（parseSessionInfoFromLite：customTitle → aiTitle →
  // lastPrompt → summary → firstPrompt 回退链），不再本地复刻标题逻辑。
  const info = parseSessionInfoFromLite(uuid, lite)
  let title = info ? info.summary : '（空会话）'
  // 大文件（head/tail 窗口不重叠）且窗口内无 customTitle：最后一条 custom-title
  // 可能被后续消息推出 64KB tail 窗口，反向扫描兜底（CLI 侧 re-append 保证仅对
  // 正常退出生效，此处覆盖进程非正常退出 / rename 后大量追加的场景）。
  if (tail !== head && !info?.customTitle) {
    const last = await findLastCustomTitle(file)
    if (last) title = last
  }
  return { title, messageCount, updatedAt: mtime }
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return !!e && (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

// C1 修复：惰性清扫。删除超过 TTL 的展示/活动记录，以及进程已退出的活动记录。
// 挂在 listSessions / pollSse / 上报入口上（这些是 Map 写入与读取的高频点），
// 不设独立定时器，避免无前端连接时空转。规模 = 活跃会话数，O(n) 遍历无碍。
function sweepStaleMaps(now = Date.now()): void {
  for (const [sid, v] of conversationDisplays) {
    if (now - v.updatedAt > DISPLAY_TTL_MS) conversationDisplays.delete(sid)
  }
  for (const [sid, v] of sessionActivity) {
    if (now - v.updatedAt > ACTIVITY_TTL_MS || !isPidAlive(v.pid)) sessionActivity.delete(sid)
  }
  for (const [sid, v] of sessionModels) {
    if (now - v.updatedAt > SESSION_MODEL_TTL_MS) sessionModels.delete(sid)
  }
}

async function listSessions(root: string) {
  sweepStaleMaps()
  const groups = findProjects(root)
  // 2026-08-23 web 独立会话：注册表里的 sessionId 标记 kind:'web'（供前端列表区分，进程停止后仍可识别）
  const webReg = loadWebSessionRegistry()
  const sessions: unknown[] = []
  for (const g of groups) {
    let files: string[] = []
    try {
      files = readdirSync(g.dir).filter((f) => f.endsWith('.jsonl') && SESSION_UUID_RE.test(f))
    } catch {
      continue
    }
    // 并行读各会话 head/tail 元数据（异步 I/O，不再同步阻塞事件循环）
    const metas = await Promise.all(files.map((f) => parseMeta(join(g.dir, f))))
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      const meta = metas[i]
      if (!meta || meta.sidechain) continue
      const p = join(g.dir, f)
      const uuid = f.replace(/\.jsonl$/, '')
      const act = sessionActivity.get(uuid)
      // web 独立会话状态：进程在跑 → busy（绿）· 已停止 → idle（红）· 未注册的 CLI 会话走 activity 上报
      const isWeb = webReg.ids.has(uuid)
      const state = isWeb ? (webSessions.has(uuid) ? 'busy' : 'idle') : act && isPidAlive(act.pid) ? act.status : null
      sessions.push({
        id: Buffer.from(p).toString('base64url'),
        projectLabel: g.label,
        projectScope: g.scope,
        preview: g.hasPreview,
        file: basename(p),
        title: meta.title,
        messageCount: meta.messageCount,
        updatedAt: meta.updatedAt,
        state,
        kind: webReg.ids.has(uuid) ? 'web' : 'cli',
      })
    }
  }
  sessions.sort((a, b) => ((b as { updatedAt: number }).updatedAt) - ((a as { updatedAt: number }).updatedAt))
  return { workspace: root, groups, sessions }
}

function decodeSessionPath(id: string, root: string): { path: string; uuid: string } {
  const p = Buffer.from(id, 'base64url').toString('utf8')
  const rootWithSep = root.endsWith(sep) ? root : root + sep
  if (!p.startsWith(rootWithSep)) throw new Error('越界路径被拒绝: ' + p)
  return { path: p, uuid: basename(p).replace(/\.jsonl$/, '') }
}

// 上下文占用（2026-08-23 dsh ContextMeter 移植数据源）：取转录最后一条 assistant 的 message.usage，
// usedTokens = input_tokens + cache_creation_input_tokens + cache_read_input_tokens（该轮发送的完整
// 上下文 token 数），除以 getContextWindowForModel(model)（auto-compact 同源窗口）。无 usage 返回 null。
function extractContextUsage(records: Record<string, unknown>[]): Record<string, unknown> | null {
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i]
    if (!r || r.type !== 'assistant') continue
    const msg = r.message as Record<string, unknown> | undefined
    const usage = msg?.usage as Record<string, unknown> | undefined
    if (!usage) continue
    const input = Number(usage.input_tokens) || 0
    const cacheCreate = Number(usage.cache_creation_input_tokens) || 0
    const cacheRead = Number(usage.cache_read_input_tokens) || 0
    if (!(input || cacheCreate || cacheRead)) continue
    const model = typeof msg?.model === 'string' && msg.model ? msg.model : ''
    const contextWindow = model ? getContextWindowForModel(model) : 0
    if (!contextWindow) continue
    const usedTokens = input + cacheCreate + cacheRead
    const percent = Math.min(100, Math.round((usedTokens / contextWindow) * 100))
    return { usedTokens, contextWindow, percent, model }
  }
  return null
}

function readSession(id: string, root: string) {
  const { path: p } = decodeSessionPath(id, root)
  // 2026-08-23 web 独立会话：新会话进程刚 spawn 时 jsonl 可能尚未落盘 → 返回空消息而非 500
  if (!existsSync(p) || !statSync(p).isFile()) return { file: basename(p), path: p, messages: [], context: null }
  const raw = readFileSync(p, 'utf8')
  const records: Record<string, unknown>[] = []
  for (const line of raw.split('\n')) {
    const s = line.trim()
    if (!s) continue
    try {
      const r = JSON.parse(s)
      // 只保留 normalizeMessages/filterConversationForDisplay 能处理的类型。
      // custom-title/agent-name/file-history-snapshot/queue-operation/last-prompt 等
      // 元记录会让 normalizeMessages 的 switch 无分支返回 undefined → isNotEmptyMessage
      // 崩溃（历史会话全部 500，遥测端看不了）。user/assistant/system 之外的展示不需要。
      if (
        r &&
        typeof r === 'object' &&
        typeof (r as { type?: unknown }).type === 'string' &&
        ['user', 'assistant', 'system', 'attachment', 'progress'].includes((r as { type: string }).type)
      ) {
        records.push(r)
      }
    } catch {
      /* 跳过坏行 */
    }
  }
  // 复用 CLI 权威过滤（conversationDisplay.filterConversationForDisplay），
  // 与 CLI 上报的 display 同源，不再本地复刻 isSynth/toBlocks 等逻辑。
  // mode 用 'prompt'（对齐 CLI 默认 REPL 显示）：thinking 全隐藏。原 'transcript' 会保留
  // 全局最后一个 thinking，遥测端历史会话因此显示出不该出现的思考过程（无效思考过滤失效）。
  const messages = filterConversationForDisplay(records as never, 'prompt')
  const context = extractContextUsage(records)
  return { file: basename(p), path: p, messages, context }
}

// 统一时间戳为毫秒（CLI 导出与 /api/session 均用数字；字符串 ISO 兜底解析）。
function tsMs(ts: unknown): number | undefined {
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts
  if (typeof ts === 'string') {
    const n = Date.parse(ts)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

type MergeMsg = { role: string; blocks: unknown[]; timestamp?: unknown }
// 合并展示消息：以磁盘 jsonl 全量历史为基底，把 live（CLI 上报的内存窗口）中比磁盘末尾
// 更新的消息追加到尾部。原因：CLI 内存窗口在上下文压缩/续接后会缺历史真实用户消息，
// 直接返回 live 会让遥测端看不到完整历史（前端按真实用户消息切段，历史被折叠成一个 blob）；
// 磁盘是完整权威。live 未越过磁盘末尾 → 磁盘已覆盖 live 全部，整段丢弃 live 不重复。
function mergeDisplayMessages(
  disk: MergeMsg[],
  live: MergeMsg[],
): MergeMsg[] {
  if (!live.length) return disk
  if (!disk.length) return live
  const dLast = tsMs(disk[disk.length - 1].timestamp)
  const lLast = tsMs(live[live.length - 1].timestamp)
  if (dLast == null || lLast == null || lLast <= dLast) return disk
  const tail = live.filter((m) => (tsMs(m.timestamp) ?? 0) > (dLast ?? 0))
  return tail.length ? [...disk, ...tail] : disk
}

// ============================================================================
// 默认预览页数据（GET /api/project）：项目无 .claude/preview 时，前端 iframe 加载
// web/default-preview/（GitHub 仓库风格），本函数提供文件树 / README / 会话元信息。
//  - 文件树：递归扫项目根，跳过重型/隐藏目录（.git/node_modules/.claude/.trash/dist 等），
//    目录在前、名称字典序；深度 ≤4、条目预算 ≤400（node_modules 等被跳过，正常项目足够）。
//  - README：项目根 README*（.md/.markdown/.txt）优先，内容截断防超大 payload。
//  - 描述：从 README 首行标题推断，兜底项目名。
// ============================================================================
const SKIP_TREE_DIRS = new Set(['.git', 'node_modules', '.claude', '.trash', '.cache', 'dist', 'cli-dist', '.idea', '.vscode'])
type TreeNode = { name: string; type: 'file' | 'dir'; children?: TreeNode[] }

/** 轻量列出一层直接子项（不递归），供预算耗尽时保证目录至少可展开一层。 */
function listOneLevel(dir: string): TreeNode[] {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  const out: TreeNode[] = []
  for (const e of entries) {
    if (out.length >= 50) break
    if (e.name.startsWith('.')) continue
    if (e.isDirectory() && SKIP_TREE_DIRS.has(e.name)) continue
    out.push(e.isDirectory() ? { name: e.name, type: 'dir' } : { name: e.name, type: 'file' })
  }
  return out
}

function walkProjectTree(dir: string, depth: number, budget: { n: number }): TreeNode[] | null {
  if (depth > 3) return null
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  // 每层 cap 50 防单层巨目录。预算按同级目录数平均分摊（同级互不挤占），
  // 深度到顶用 listOneLevel 兜底，保证任意目录至少可展开看到下一级。
  const out: TreeNode[] = []
  for (const e of entries) {
    if (out.length >= 50) break
    if (budget.n <= 0) break
    if (e.name.startsWith('.')) continue
    if (e.isDirectory() && SKIP_TREE_DIRS.has(e.name)) continue
    budget.n--
    out.push(e.isDirectory() ? { name: e.name, type: 'dir' } : { name: e.name, type: 'file' })
  }
  const dirs = out.filter((it) => it.type === 'dir')
  if (dirs.length) {
    const per = Math.floor(budget.n / dirs.length)
    for (const it of dirs) {
      const sub = { n: Math.max(0, per) }
      const children = walkProjectTree(join(dir, it.name), depth + 1, sub)
      if (children && children.length) it.children = children
      else {
        const shallow = listOneLevel(join(dir, it.name))
        if (shallow.length) it.children = shallow
      }
    }
    budget.n = 0
  }
  return out
}

function findProjectReadme(dir: string): string | null {
  const names = ['README.md', 'readme.md', 'README.markdown', 'readme.markdown', 'README.txt', 'readme.txt']
  for (const n of names) {
    const p = join(dir, n)
    if (existsSync(p) && statSync(p).isFile()) {
      const txt = readFileSync(p, 'utf8')
      return txt.length > 200 * 1024 ? txt.slice(0, 200 * 1024) : txt
    }
  }
  try {
    const hit = readdirSync(dir).find((f) => /^readme/i.test(f) && !/^\./.test(f))
    if (hit) {
      const p = join(dir, hit)
      if (existsSync(p) && statSync(p).isFile()) {
        const txt = readFileSync(p, 'utf8')
        return txt.length > 200 * 1024 ? txt.slice(0, 200 * 1024) : txt
      }
    }
  } catch {
    /* 忽略 */
  }
  return null
}

function deriveProjectDescription(readme: string | null, label: string): string {
  if (readme) {
    for (const line of readme.split('\n')) {
      const m = /^#\s+(.+?)\s*$/.exec(line)
      if (m) return m[1].trim().slice(0, 120)
    }
  }
  return label
}

// ============================================================================
// 插件/技能清单（便携根扫描；供 MGR 管理视图 GET /api/plugins）
//  - 已安装插件：.claude/plugins/<name>/.claude-plugin/plugin.json
//  - 已安装技能：.claude/skills/<name>/SKILL.md 的 frontmatter（name/description）
//  - 公开市场：.claude/plugins/marketplaces/*/.claude-plugin/marketplace.json 的 plugins[]
//    （技能类条目按名称含 "skill" 归类；inst=1 表示已安装，便于前端打「已安装」徽标）
// ============================================================================
function readJsonObject(p: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function parseSkillFrontmatter(text: string): { name: string; description: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const out = { name: '', description: '' }
  if (!m) return out
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i <= 0) continue
    const key = line.slice(0, i).trim()
    const val = line.slice(i + 1).trim()
    if (key === 'name') out.name = val
    else if (key === 'description') out.description = val
  }
  return out
}

function listPlugins(root: string): Record<string, unknown> {
  const pluginsDir = join(root, '.claude', 'plugins')
  const skillsDir = join(root, '.claude', 'skills')

  // 已安装插件（跳过 data/marketplaces 等系统目录与隐藏目录）
  const personalPlugins: Array<Record<string, unknown>> = []
  if (isDir(pluginsDir)) {
    for (const e of readdirSync(pluginsDir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'data' || e.name === 'marketplaces') continue
      const m = readJsonObject(join(pluginsDir, e.name, '.claude-plugin', 'plugin.json'))
      if (!m) continue
      personalPlugins.push({
        n: String(m.name || e.name),
        d: String(m.description || ''),
        v: String(m.version || ''),
        inst: 1,
      })
    }
  }

  // 已安装技能（只有带 SKILL.md 的目录才算技能）
  const personalSkills: Array<Record<string, unknown>> = []
  if (isDir(skillsDir)) {
    for (const e of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      const fp = join(skillsDir, e.name, 'SKILL.md')
      if (!existsSync(fp)) continue
      const fm = parseSkillFrontmatter(readFileSync(fp, 'utf8'))
      personalSkills.push({ n: fm.name || e.name, d: fm.description, inst: 1 })
    }
  }

  // 公开市场（官方 marketplace.json 的 plugins[]；技能条目按名称含 skill 归类）
  const marketPlugins: Array<Record<string, unknown>> = []
  const marketSkills: Array<Record<string, unknown>> = []
  const mktDir = join(pluginsDir, 'marketplaces')
  if (isDir(mktDir)) {
    const installed = new Set(personalPlugins.map((p) => String(p.n)))
    for (const e of readdirSync(mktDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const m = readJsonObject(join(mktDir, e.name, '.claude-plugin', 'marketplace.json'))
      const items = Array.isArray(m?.plugins) ? (m.plugins as Array<{ name?: unknown; description?: unknown }>) : []
      for (const it of items) {
        const name = String(it?.name || '')
        if (!name) continue
        const rec = { n: name, d: String(it?.description || ''), inst: installed.has(name) ? 1 : 0 }
        if (/skill/i.test(name)) marketSkills.push(rec)
        else marketPlugins.push(rec)
      }
    }
  }

  // 已安装置顶（inst 降序优先），同安装状态按名称字母序
  const sortN = (a: Record<string, unknown>, b: Record<string, unknown>) =>
    (Number(b.inst) - Number(a.inst)) || String(a.n).localeCompare(String(b.n))
  personalPlugins.sort(sortN)
  personalSkills.sort(sortN)
  marketPlugins.sort(sortN)
  marketSkills.sort(sortN)

  return {
    workspace: root,
    plugins: { personal: personalPlugins, public: marketPlugins },
    skills: { personal: personalSkills, public: marketSkills },
  }
}

// ============================================================================
// 模型配置（MGR 管理视图 GET /api/models，与 SubPj1 server.mjs 同逻辑）
// 数据源 = 便携根 .claude/credentials.json 凭据池各 provider 的可用模型 +
//          settings.json 的 model 字段 + env 中模型类环境变量 + 进程实际环境。
// 只读展示，不改写任何配置。
// ============================================================================
const MODEL_ENV_KEYS = [
  'ANTHROPIC_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
]
const MODEL_PROVIDER_LABELS: Record<string, string> = {
  deepseek: 'DeepSeek',
  anthropic: 'Claude · Anthropic',
  claude: 'Claude · Anthropic',
  openai: 'OpenAI',
  qwen: 'Qwen · 通义千问',
  dashscope: 'Qwen · 通义千问',
  gemini: 'Google Gemini',
  glm: '智谱 GLM',
  moonshot: 'Moonshot Kimi',
  openrouter: 'OpenRouter',
}
function modelProviderLabel(name: string): string {
  return MODEL_PROVIDER_LABELS[name.toLowerCase()] || name
}
function listModels(root: string): Record<string, unknown> {
  const settingsPath = join(root, '.claude', 'settings.json')
  const settings = readJsonObject(settingsPath) || {}
  const items: Array<{ k: string; v: string; src: string }> = []
  if (settings.model !== undefined) items.push({ k: 'model', v: String(settings.model), src: 'settings.json' })
  const env0 = settings.env && typeof settings.env === 'object' ? (settings.env as Record<string, unknown>) : {}
  const seen = new Set(items.map((i) => i.k))
  for (const k of MODEL_ENV_KEYS) {
    if (env0[k] !== undefined && !seen.has(k)) {
      items.push({ k, v: String(env0[k]), src: 'settings.json → env' })
      seen.add(k)
    }
  }
  for (const k of MODEL_ENV_KEYS) {
    if (process.env[k] !== undefined && !seen.has(k)) {
      items.push({ k, v: String(process.env[k]), src: '进程环境变量' })
      seen.add(k)
    }
  }
  // 凭据池：credentials.json providers[].models[] = 各供应商实际可用的模型清单
  const creds = readJsonObject(join(root, '.claude', 'credentials.json')) || {}
  const providers =
    creds.providers && typeof creds.providers === 'object'
      ? (creds.providers as Record<string, unknown>)
      : {}
  const poolRows: Array<{ k: string; v: string; src: string; vision?: boolean }> = []
  const poolSet = new Set<string>()
  for (const [name, cfg0] of Object.entries(providers)) {
    const cfg = (cfg0 && typeof cfg0 === 'object' ? cfg0 : {}) as Record<string, unknown>
    const models = Array.isArray(cfg.models) ? (cfg.models as string[]) : []
    const mv =
      cfg.modelVision && typeof cfg.modelVision === 'object' ? (cfg.modelVision as Record<string, unknown>) : {}
    const label = modelProviderLabel(name)
    for (const m of models) {
      if (poolSet.has(m)) continue
      poolSet.add(m)
      poolRows.push({ k: m, v: m, src: `凭据池·${label}`, vision: mv[m] === true })
    }
  }
  // 已作为凭据池模型展示的 settings/env 条目不再重复（同一模型只出现一次）
  const cfgItems = items.filter((it) => !poolSet.has(it.v))
  // 当前真实启用模型 = 凭据池 activeModel（与 CLI getUserSpecifiedModelSetting 同源，优先级高于 settings.model）；
  // 无凭据池配置时回落到 settings.model，保证显示值与 CLI 实际使用一致。
  const activeModel = getActiveModel()
  const activeCfg = getActiveProviderConfig()
  return {
    workspace: root,
    model: activeModel ?? (settings.model !== undefined ? String(settings.model) : null),
    activeProvider: creds.activeProvider || null,
    activeModel,
    // 当前供应商可切换的模型清单（每会话模型切换的校验集；前端模型浮窗据此渲染）
    providerModels: activeCfg && Array.isArray(activeCfg.models) ? (activeCfg.models as string[]) : [],
    effortLevel: settings.effortLevel !== undefined ? String(settings.effortLevel) : null,
    source: settingsPath,
    items: [...poolRows, ...cfgItems],
  }
}

/**
 * 写便携根 .claude/settings.json 的 effortLevel 字段（全局持久化，供 CLI 下次启动读取；实时切换由下方
 * 广播 {type:'effort'} 控制消息到在线 CLI 完成）。模型为每会话切换（不写盘，见 /api/model 处理器），
 * 不写 settings.model，避免与 CLI 同源显示错位。保留其它字段不破坏。
 */
function writeSettingsModel(root: string, patch: { effortLevel?: string | null }): void {
  const settingsPath = join(root, '.claude', 'settings.json')
  const settings = readJsonObject(settingsPath) || {}
  if ('effortLevel' in patch) {
    if (patch.effortLevel == null) delete settings.effortLevel
    else settings.effortLevel = patch.effortLevel
  }
  try {
    mkdirSync(join(settingsPath, '..'), { recursive: true })
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', { encoding: 'utf8' })
  } catch {
    /* 写失败静默：持久化非关键路径，实时广播仍生效 */
  }
}

/** 广播控制消息给所有在线 CLI 进程（/clients 注册的 WS）。 */
function broadcastToClients(msg: unknown): void {
  const s = JSON.stringify(msg)
  for (const c of cliClients.values()) {
    try {
      c.send(s)
    } catch {
      /* 断开忽略 */
    }
  }
}

/** 精确路由控制消息到指定会话（/clients 注册的 WS）；无 sessionId/未命中 → 返回 false（不广播兜底，2026-08-23 用户定案）。 */
function routeToClient(sessionId: string | undefined, msg: unknown): boolean {
  if (!sessionId) return false
  const target = cliClients.get(sessionId)
  if (target && target.readyState === WebSocket.OPEN) {
    try {
      target.send(JSON.stringify(msg))
      return true
    } catch {
      /* 断开忽略，返回 false（不广播兜底） */
    }
  }
  return false
}

// ============================================================================
// SSE 实时事件（jsonl 变化，事件驱动）
// ============================================================================
// O4：watch 事件 → 去抖 → pollSse 扫描。watch 事件仅做「有变化」的提示，真正 diff 仍由 pollSse
// 用 size/mtime 判定（与旧轮询同一逻辑），保证跨平台（尤其 Windows ReadDirectoryChangesW 只给
// 文件名不给内容）也能准确识别具体哪个会话文件变了。
function scheduleSseFlush(root: string): void {
  if (sseClients.size === 0 || sseDebounce) return
  sseDebounce = setTimeout(() => {
    sseDebounce = null
    pollSse(root)
  }, 250)
}
function ensureSseWatches(root: string): void {
  if (sseWatches.size > 0) return
  for (const g of findProjects(root)) {
    try {
      const w = watch(g.dir, () => scheduleSseFlush(root))
      sseWatches.add(w)
    } catch {
      /* 目录不存在/被移除，忽略 */
    }
  }
}
function stopSseWatches(): void {
  for (const w of sseWatches) {
    try {
      w.close()
    } catch {
      /* 忽略 */
    }
  }
  sseWatches.clear()
  if (sseDebounce) {
    clearTimeout(sseDebounce)
    sseDebounce = null
  }
}

function pollSse(root: string): void {
  if (sseClients.size === 0) return
  sweepStaleMaps()
  const groups = findProjects(root)
  for (const g of groups) {
    let files: string[] = []
    try {
      files = readdirSync(g.dir).filter((f) => f.endsWith('.jsonl') && SESSION_UUID_RE.test(f))
    } catch {
      continue
    }
    for (const f of files) {
      const p = join(g.dir, f)
      let st: { size: number; mtimeMs: number }
      try {
        st = statSync(p)
      } catch {
        continue
      }
      const prev = sseSizes.get(p)
      const changed = !!prev && (prev.size !== st.size || prev.mtime !== st.mtimeMs)
      if (ssePrimed && (changed || !prev)) {
        const obj = { type: 'updated', hash: f.replace(/\.jsonl$/, ''), file: f, updatedAt: st.mtimeMs }
        const s = `data: ${JSON.stringify(obj)}\n\n`
        for (const c of sseClients) {
          try {
            c.res.write(s)
          } catch {
            /* 断开忽略 */
          }
        }
      }
      sseSizes.set(p, { size: st.size, mtime: st.mtimeMs })
    }
  }
  ssePrimed = true
}

// ============================================================================
// HTTP / WS
// ============================================================================
type ServerResponse = import('node:http').ServerResponse
// O2：统一 JSON 响应帮助函数，消除 handleRequest 内每路由重复的 writeHead/end/JSON.stringify
function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
  res.end(JSON.stringify(obj))
}
function sendError(res: ServerResponse, e: unknown): void {
  sendJson(res, 500, { error: String((e && (e as Error).message) || e) })
}

async function handleRequest(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, root: string): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`)
  // 安全加固（2026-08-15）：HTTP 数据接口与 WS 升级一致要求 token。
  //  - /api/health 保持公开探活（/server status、前端 detectGateway 只读 mode），响应已精简不含路径泄露；
  //  - 其余 /api/*（会话/插件/SSE/上报写接口）与 /preview/* 一律校验 query token，失败 401。
  //  - /default-preview/* 是网关内置静态页（index.html/default.css/default.js，无敏感数据），
  //    不锁 token（页内相对资源请求不带 token，锁了会 401 致 JS/CSS 加载失败）；敏感数据在
  //    /api/project（属于 /api/* 已受保护），由页面 JS 从自身 URL query 读 token 附加。
  // token 通过 URL query 传递：前端从 location.search 提取附加，CLI 侧上报从 gatewayToken.ts 读取附加。
  const isProtected =
    (url.pathname.startsWith('/api/') && url.pathname !== '/api/health') || url.pathname.startsWith('/preview/')
  if (isProtected && url.searchParams.get('token') !== currentToken) {
    sendJson(res, 401, { error: 'unauthorized' })
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true, mode: 'gateway' })
    return
  }
  // 2026-08-17 独立网关优雅关闭端点（受上方 /api/* token 校验保护）：/server off 调用。
  // 先回响应，再 stopLocalGateway + 退出进程（网关是独立 --gateway 进程，exit 即释放端口）。
  if (req.method === 'POST' && url.pathname === '/api/shutdown') {
    sendJson(res, 200, { ok: true, stopping: true })
    setTimeout(() => {
      stopLocalGateway()
      process.exit(0)
    }, 50)
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/sessions') {
    try {
      sendJson(res, 200, await listSessions(root))
    } catch (e) {
      sendError(res, e)
    }
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/plugins') {
    try {
      sendJson(res, 200, listPlugins(root))
    } catch (e) {
      sendError(res, e)
    }
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/models') {
    try {
      sendJson(res, 200, listModels(root))
    } catch (e) {
      sendError(res, e)
    }
    return
  }
  // 2026-08-22 模型/思考等级切换（受上方 /api/* token 校验保护）：
  //   POST /api/model {model?, effortLevel?, sessionId?}
  //   - model → 每会话切换：不写全局凭据池，校验在 activeProvider.models 内，按 sessionId 精确路由
  //     到对应 CLI 进程（{type:'model'} 实时生效，该进程 STATE 覆盖仅本会话；无 sessionId/未命中广播兜底）。
  //   - effortLevel → 写 settings.json effortLevel（全局持久化）+ 广播 {type:'effort'} 实时生效。
  if (req.method === 'POST' && url.pathname === '/api/model') {
    try {
      const parsed = await readReportBody(req)
      const model = typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model.trim() : undefined
      const sessionId =
        typeof parsed.sessionId === 'string' && parsed.sessionId.trim() ? parsed.sessionId.trim() : undefined
      const rawEffort =
        typeof parsed.effortLevel === 'string' && parsed.effortLevel.trim() ? parsed.effortLevel.trim() : undefined
      const defaultModel =
        typeof parsed.defaultModel === 'string' && parsed.defaultModel.trim() ? parsed.defaultModel.trim() : undefined
      // 'off'/'auto'/'default' = 清除思考等级（delete settings.effortLevel + 广播 null → CLI effortValue=undefined）
      const effortLevel =
        rawEffort === 'off' || rawEffort === 'auto' || rawEffort === 'default' ? null : rawEffort
      if (model === undefined && effortLevel === undefined && defaultModel === undefined) {
        sendJson(res, 400, { error: 'invalid body' })
        return
      }
      if (model !== undefined) {
        const cfg = getActiveProviderConfig()
        if (!cfg || !Array.isArray(cfg.models) || !cfg.models.includes(model)) {
          sendJson(res, 400, { error: `model "${model}" 不在当前供应商模型清单中` })
          return
        }
      }
      if (defaultModel !== undefined) {
        // 设为全局默认模型：switchModel 写 credentials.json activeModel（校验在 activeProvider.models 内）；
        // 仅全局默认、不广播不路由，当前会话不受影响（2026-08-23 用户定案）
        if (!switchModel(defaultModel)) {
          sendJson(res, 400, { error: `model "${defaultModel}" 不在当前供应商模型清单中` })
          return
        }
      }
      if (effortLevel !== undefined) writeSettingsModel(root, { effortLevel })
      if (model !== undefined) {
        // model 每会话覆盖，精确路由到目标会话；未在线/未连接则拒绝而非广播兜底（2026-08-23 用户定案）
        if (!routeToClient(sessionId, { type: 'model', value: model })) {
          sendJson(res, 400, { error: '目标会话未在线，无法切换模型' })
          return
        }
      }
      if (effortLevel !== undefined) broadcastToClients({ type: 'effort', value: effortLevel })
      sendJson(res, 200, { ok: true, model: model ?? null, effortLevel: effortLevel ?? null, defaultModel: defaultModel ?? null })
    } catch (error) {
      const status = error instanceof ReportBodyTooLargeError ? 413 : 400
      sendJson(res, status, { error: status === 413 ? 'payload too large' : 'invalid body' })
    }
    return
  }
  // 2026-08-23 web 独立会话（受上方 /api/* token 校验保护）：
  //   POST /api/wsession {resume?} → spawn headless CLI 子进程，返回 {id}；resume 恢复已有会话
  //   POST /api/wsession/stop {id} → 优雅关闭子进程
  if (req.method === 'POST' && url.pathname === '/api/wsession') {
    try {
      const parsed = await readReportBody(req)
      const resume =
        typeof parsed.resume === 'string' && parsed.resume.trim() ? parsed.resume.trim() : undefined
      // 2026-08-24 指定项目：project = findProjects 命中的项目 label → 会话落该项目 .claude/projects
      const project =
        typeof parsed.project === 'string' && parsed.project.trim() ? parsed.project.trim() : undefined
      const sid = await spawnWebSession(resume, project)
      // id = listSessions 同源 base64url（web 会话落盘 <项目根>/.claude/projects；笔=全局根、项目=项目根）；
      // hash = 前端导航/WS 过滤用的会话哈希（= 转录文件名去 .jsonl，即 sessionId）
      // resume 未显式指定项目时按注册表定位（与 spawnWebSession effectiveProject 同源）
      let projLabel = project
      if (resume && !projLabel) projLabel = loadWebSessionRegistry().projects[resume]
      const projRoot = webSessionProjectRoot(projLabel)
      const id = Buffer.from(join(projRoot, '.claude', 'projects', `${sid}.jsonl`)).toString('base64url')
      sendJson(res, 200, { id, hash: sid, resumed: !!resume, project: project ?? null })
    } catch (e) {
      sendError(res, e)
    }
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/wsession/stop') {
    try {
      const parsed = await readReportBody(req)
      const id = typeof parsed.id === 'string' && parsed.id.trim() ? parsed.id.trim() : ''
      sendJson(res, 200, { ok: id ? stopWebSession(id) : false })
    } catch (e) {
      sendError(res, e)
    }
    return
  }
  // 2026-08-24 审批链路诊断（受 token 保护）：返回最近审批轨迹 + 连接概览，用于调试「审批卡不弹」。
  if (req.method === 'GET' && url.pathname === '/api/diagnostics') {
    sendJson(res, 200, {
      trail: approvalTrailSnapshot(),
      cliClients: [...cliClients.keys()],
      sockets: sockets.size,
      sseClients: sseClients.size,
      webSessions: [...webSessions.keys()],
    })
    return
  }
  // → 直接复用 CLI /rename 的落盘逻辑（saveCustomTitle + saveAgentName，见命令 rename.ts），
  // 与 CLI 完全同路径：写盘格式含 sessionId（loadTranscriptFile/restoreSessionMetadata 按
  // entry.sessionId 建索引，缺字段会被 resume 跳过 → 旧标题在退出时 re-append 回退 web 列表）；
  // 若目标会话恰好是网关宿主 CLI 的当前会话，还会同步更新 CLI 内存标题缓存。
  // 对已停止的会话同样生效；正在运行的会话下次列表刷新读盘即见新标题。
  if (req.method === 'POST' && url.pathname === '/api/session/rename') {
    try {
      const parsed = await readReportBody(req)
      const id = typeof parsed.id === 'string' && parsed.id.trim() ? parsed.id.trim() : ''
      const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
      if (!id || !title) {
        sendJson(res, 400, { error: 'id 与 title 必填' })
        return
      }
      if (title.length > 200) {
        sendJson(res, 400, { error: '标题过长（最多 200 字符）' })
        return
      }
      const { path: p, uuid } = decodeSessionPath(id, root)
      if (!existsSync(p)) {
        sendJson(res, 404, { error: 'session not found' })
        return
      }
      await saveCustomTitle(uuid as UUID, title, p)
      await saveAgentName(uuid as UUID, title, p)
      // 2026-08-25 web 重命名 → CLI 实时同步：目标会话若有 /clients 注册的在线 CLI 进程
      //（web 独立会话窗口 / 终端 CLI），按会话精确路由 rename 事件，CLI 侧更新内存标题缓存
      // + 输入栏徽标（standaloneAgentContext），无需重启即可看到新名字；未命中静默跳过。
      routeToClient(uuid, { type: 'rename', sessionId: uuid, title })
      scheduleSseFlush(root) // 立即触发列表刷新，让新标题落进前端列表
      sendJson(res, 200, { ok: true, title })
    } catch (e) {
      sendError(res, e)
    }
    return
  }
  // 默认预览页数据：/api/project?label=<项目> → 文件树 + README + 会话元信息（GitHub 仓库风格默认界面）
  // 2026-08-19 Web 容器：/api/backend?label=<项目> → 懒加载 spawn 该项目 preview.json 声明的后端进程，
  // 返回 {url} 供前端 iframe 直连（受上方 /api/* token 校验保护；后端仅监听 127.0.0.1，访问面可控）。
  if (req.method === 'GET' && url.pathname === '/api/backend') {
    const bLabel = url.searchParams.get('label') || ''
    const bProj = findProjects(root).find((g) => g.scope === 'project' && g.label === bLabel && g.hasBackend)
    if (!bProj || !bProj.backendCfg) {
      sendJson(res, 404, { error: 'no backend for project' })
      return
    }
    try {
      const proc = await ensureBackend(bLabel, bProj.backendCfg)
      // name：overlay 提示用（preview.json backend.name 或项目 label），前端据此显示「正在启动 <name>…」，可插拔
      sendJson(res, 200, { url: `http://127.0.0.1:${proc.port}/`, port: proc.port, pid: proc.pid, name: proc.cfg.name || bLabel })
    } catch (e) {
      sendError(res, e)
    }
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/project') {
    const pLabel = url.searchParams.get('label') || ''
    const pProj = findProjects(root).find((g) => g.scope === 'project' && g.label === pLabel)
    if (!pProj) {
      sendJson(res, 404, { error: 'project not found' })
      return
    }
    try {
      const pDir = resolve(pProj.dir, '..', '..') // pProj.dir = <root>/<label>/.claude/projects，上两级才是项目根（resolve '..' 只到 .claude）
      const budget = { n: 2000 }
      const files = walkProjectTree(pDir, 0, budget) ?? []
      const readme = findProjectReadme(pDir)
      const list = await listSessions(root)
      const pSessions = (list.sessions as Array<Record<string, unknown>>)
        .filter((s) => s.projectScope === 'project' && s.projectLabel === pLabel)
        .map((s) => ({
          hash: String(s.file).replace(/\.jsonl$/, ''),
          id: s.id,
          title: s.title,
          messageCount: s.messageCount,
          updatedAt: s.updatedAt,
        }))
        .slice(0, 100)
      sendJson(res, 200, {
        label: pLabel,
        scope: 'project',
        hasPreview: pProj.hasPreview,
        description: deriveProjectDescription(readme, pLabel),
        files,
        readme,
        sessionCount: pSessions.length,
        sessions: pSessions,
        lastActive: pSessions.length ? (pSessions[0].updatedAt as number) : 0,
      })
    } catch (e) {
      sendError(res, e)
    }
    return
  }
  // 项目内文件内容读取：/api/file?label=<项目>&path=<项目内相对路径> → 原始字节
  // （供个性化预览页识图渲染 Obsidian canvas / 加载图片音频视频）。受上方 /api/* token 校验保护。
  if (req.method === 'GET' && url.pathname === '/api/file') {
    const fLabel = url.searchParams.get('label') || ''
    const fPath = url.searchParams.get('path') || ''
    const fProj = findProjects(root).find((g) => g.scope === 'project' && g.label === fLabel)
    if (!fProj) {
      sendJson(res, 404, { error: 'project not found' })
      return
    }
    const fDir = resolve(fProj.dir, '..', '..') // 项目根（fProj.dir = <root>/<label>/.claude/projects）
    const fAbs = resolve(fDir, fPath)
    if (fAbs !== fDir && !fAbs.startsWith(fDir + sep)) {
      sendJson(res, 403, { error: 'forbidden' })
      return
    }
    if (!existsSync(fAbs) || !statSync(fAbs).isFile()) {
      sendJson(res, 404, { error: 'not found' })
      return
    }
    if (statSync(fAbs).size > 4 * 1024 * 1024) {
      sendJson(res, 413, { error: 'too large' })
      return
    }
    const fType = MIME[extname(fAbs)] ?? 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': fType, 'Cache-Control': 'no-cache' })
    res.end(readFileSync(fAbs))
    return
  }
  // 项目预览页静态托管：/preview/<项目>/* → <root>/<项目>/.claude/preview/*（点击项目胶囊时前端 iframe 加载替换界面）
  // label 必须是 findProjects 命中且带 .claude/preview 的真实项目（用 dir 推 preview 目录，避免按 label 拼路径）；
  // 子路径 resolve 后必须落在 preview 目录内（越界防护），默认 index.html。
  const pvMatch = /^\/preview\/([^/]+)((?:\/.*)?)$/.exec(url.pathname)
  if (req.method === 'GET' && pvMatch) {
    const pvLabel = decodeURIComponent(pvMatch[1])
    const pvRel = (pvMatch[2] || '').replace(/^\//, '') || 'index.html'
    const pvProj = findProjects(root).find((g) => g.scope === 'project' && g.label === pvLabel && g.hasPreview)
    if (!pvProj) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not Found')
      return
    }
    const pvDir = join(pvProj.dir, '..', 'preview') // pvProj.dir = <root>/<label>/.claude/projects
    const pvFile = resolve(pvDir, pvRel)
    if (pvFile !== pvDir && !pvFile.startsWith(pvDir + sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Forbidden')
      return
    }
    if (!existsSync(pvFile) || !statSync(pvFile).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not Found')
      return
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(pvFile)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    })
    res.end(readFileSync(pvFile))
    return
  }
  // 内置默认预览页（GitHub 仓库风格，项目无 .claude/preview 时的兜底界面）：
  // /default-preview/<项目>/* → 内嵌 web 资源 default-preview/*（label 必须命中 findProjects 防任意路径）。
  const dpMatch = /^\/default-preview\/([^/]+)((?:\/.*)?)$/.exec(url.pathname)
  if (req.method === 'GET' && dpMatch) {
    const dpLabel = decodeURIComponent(dpMatch[1])
    const dpProj = findProjects(root).find((g) => g.scope === 'project' && g.label === dpLabel)
    if (!dpProj) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not Found')
      return
    }
    const dpRel = (dpMatch[2] || '').replace(/^\//, '') || 'index.html'
    const dpBuf = readWebAsset(`default-preview/${dpRel}`)
    if (!dpBuf) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not Found')
      return
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(dpRel)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    })
    res.end(dpBuf)
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/session') {
    const id = url.searchParams.get('id')
    if (!id) {
      sendJson(res, 400, { error: 'missing id' })
      return
    }
    try {
      const { path: p, uuid } = decodeSessionPath(id, root)
      // 历史一律以磁盘 jsonl 全量为基底（readSession，含上下文压缩前的完整历史）；
      // CLI 上报的内存窗口（conversationDisplays）只作尾部追加——直接返回 live 会因
      // 内存窗口缺失历史用户消息而看不到完整历史。
      const data = readSession(id, root)
      const disp = conversationDisplays.get(uuid)
      if (disp && Array.isArray(disp.messages) && disp.messages.length) {
        data.messages = mergeDisplayMessages(data.messages as never, disp.messages as never)
        data.display = data.messages
      }
      // 2026-08-24 模型 web/CLI 同步：附每会话实际模型（CLI 上报，override 不落盘只此有源）+
      // 上报时间戳（web 端据此判断是否覆盖本地选择）；无上报时回落 null（web 回落凭据池 activeModel）。
      const sm = sessionModels.get(uuid)
      data.model = sm?.model ?? null
      data.modelTs = sm?.updatedAt ?? null
      sendJson(res, 200, data)
    } catch (e) {
      sendError(res, e)
    }
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/conversation') {
    try {
      const parsed = await readReportBody(req)
      const sid = typeof parsed.sessionId === 'string' ? parsed.sessionId : ''
      const msgs = Array.isArray(parsed.messages) ? parsed.messages : null
      if (!sid || !msgs) {
        sendJson(res, 400, { error: 'invalid body' })
        return
      }
      conversationDisplays.set(sid, { messages: msgs, updatedAt: Date.now() })
      sweepStaleMaps()
      sendJson(res, 200, { ok: true })
    } catch (error) {
      const status = error instanceof ReportBodyTooLargeError ? 413 : 400
      sendJson(res, status, { error: status === 413 ? 'payload too large' : 'invalid body' })
    }
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/activity') {
    try {
      const parsed = await readReportBody(req)
      const sid = typeof parsed.sessionId === 'string' ? parsed.sessionId : ''
      const status = typeof parsed.status === 'string' && ['busy', 'idle', 'waiting'].includes(parsed.status)
        ? parsed.status
        : null
      if (!sid || !status) {
        sendJson(res, 400, { error: 'invalid body' })
        return
      }
      sessionActivity.set(sid, {
        status,
        pid: Number(parsed.pid) || 0,
        cwd: typeof parsed.cwd === 'string' && parsed.cwd ? parsed.cwd : undefined,
        updatedAt: Date.now(),
      })
      sweepStaleMaps()
      sendJson(res, 200, { ok: true })
    } catch (error) {
      const status = error instanceof ReportBodyTooLargeError ? 413 : 400
      sendJson(res, status, { error: status === 413 ? 'payload too large' : 'invalid body' })
    }
    return
  }
  // 2026-08-24 模型 web/CLI 同步：CLI 侧 reportCurrentModel 上报每会话实际模型（内存 Map，TTL 清扫）。
  // 每会话 override 不写凭据池，web 端 /api/session 据此读取校准模型 seat，与 CLI 实际使用一致。
  if (req.method === 'POST' && url.pathname === '/api/model-report') {
    try {
      const parsed = await readReportBody(req)
      const sid = typeof parsed.sessionId === 'string' ? parsed.sessionId : ''
      const model = typeof parsed.model === 'string' && parsed.model.trim() ? parsed.model.trim() : ''
      if (!sid || !model) {
        sendJson(res, 400, { error: 'invalid body' })
        return
      }
      sessionModels.set(sid, { model, updatedAt: Date.now() })
      sweepStaleMaps()
      sendJson(res, 200, { ok: true })
    } catch (error) {
      const status = error instanceof ReportBodyTooLargeError ? 413 : 400
      sendJson(res, status, { error: status === 413 ? 'payload too large' : 'invalid body' })
    }
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/events') {
    // SSE：idleTimeout 禁用（长连接保持，避免重连级联）
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    const client = { res }
    sseClients.add(client)
    scheduleIdleShutdown()
    res.write(`data: ${JSON.stringify({ type: 'hello', time: Date.now() })}\n\n`)
    req.on('close', () => {
      sseClients.delete(client)
      scheduleIdleShutdown()
    })
    // O4：建立文件监听 + 立即 primed 一轮（填充 sseSizes 基线），后续变化由 watch 事件驱动
    ensureSseWatches(root)
    pollSse(root)
    return
  }
  // 静态资源：内嵌 web 资源优先（打包进 exe），磁盘 SubPj public 兜底（开发模式）
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '')
  const embedded = readWebAsset(rel)
  if (embedded) {
    res.writeHead(200, {
      'Content-Type': MIME[extname(rel)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    })
    res.end(embedded)
    return
  }
  const pub = publicDir(root)
  const file = resolve(pub, rel)
  if (!isPathInside(pub, file) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not Found')
    return
  }
  const body = readFileSync(file)
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': 'no-cache',
  })
  res.end(body)
}

function broadcast(msg: unknown): void {
  const s = JSON.stringify(msg)
  for (const c of sockets) {
    try {
      c.send(s)
    } catch {
      /* 断开忽略 */
    }
  }
}

/** 遥测端 WS 断开 → 从所有 web 会话订阅集合中摘除（重连后前端重新 subscribe） */
function detachWebSessionClient(ws: WebSocket): void {
  for (const p of webSessions.values()) {
    p.clients.delete(ws)
  }
}

// 2026-08-24 审批链路诊断轨迹：环形日志记录 /clients 注册、approval-request 接收与广播、
// approve 接收与路由、local-resolved/cancel。GET /api/diagnostics 读取（调试审批「卡片不弹」）。
const approvalTrail: Array<{ ts: number; ev: string; sessionId?: string; requestId?: string; detail?: string }> = []
function approvalTrailPush(ev: string, sessionId?: string, requestId?: string, detail?: string): void {
  approvalTrail.push({ ts: Date.now(), ev, sessionId, requestId, detail })
  if (approvalTrail.length > 500) approvalTrail.splice(0, approvalTrail.length - 500)
}
function approvalTrailSnapshot(): unknown[] {
  return approvalTrail.slice(-50).reverse()
}

function handleWsMessage(ws: WebSocket, raw: string): void {
  let data: { type?: string; text?: string; requestId?: string; allowed?: boolean; sessionId?: string; toolUseId?: string; input?: unknown; answers?: Record<string, string> }
  try {
    data = JSON.parse(raw)
  } catch {
    return
  }
  switch (data.type) {
    case 'send': {
      const text = data.text ?? ''
      if (!text.trim()) break
      // 2026-08-24 web 会话改造：web 会话 = 本地可见交互 REPL（CLI 自己连 /clients 注册），
      // 消息不再写子进程 stdin（stdin 归本地终端窗口），统一经 cliClients 精确路由 →
      // CLI 侧 gatewayClient enqueue 注入 REPL（与本地打字同路径）。审批也在本地窗口操作。
      // 会话启动中（/api/wsession 已返回但 CLI 尚未注册 /clients，理论竞态）→ 提示稍后再发。
      if (data.sessionId) {
        const target = cliClients.get(data.sessionId)
        if (target && target.readyState === WebSocket.OPEN) {
          target.send(JSON.stringify({ type: 'send', text }))
        } else if (webSessions.has(data.sessionId)) {
          ws.send(JSON.stringify({ type: 'status', state: 'web 会话启动中，请稍后再发送' }))
        } else {
          ws.send(JSON.stringify({ type: 'status', state: '目标会话未在线，消息未注入' }))
        }
        break
      }
      // 无 sessionId → 广播全部在线 CLI 客户端；无在线 CLI → status 提示
      if (cliClients.size) {
        for (const c of cliClients.values()) {
          try {
            c.send(JSON.stringify({ type: 'send', text }))
          } catch {
            /* 断开忽略 */
          }
        }
      } else {
        ws.send(JSON.stringify({ type: 'status', state: '当前无在线 CLI 进程，消息未注入' }))
      }
      break
    }
    case 'approve': {
      // 2026-08-24 审批双操作（web 与 CLI 均可）：floria 审批卡的应答路由回对应 CLI 会话
      // （/clients 注册的交互 REPL——普通 CLI 会话与 web 独立会话窗口同路径，均支持远程审批）。
      const target = data.sessionId ? cliClients.get(data.sessionId) : undefined
      if (target && target.readyState === WebSocket.OPEN) {
        approvalTrailPush('floria-approve-routed', data.sessionId, data.requestId, data.allowed === true ? 'allow' : 'deny')
        // 2026-08-24 提问答复：floria 交互表单提交答案 → updatedInput 带 {questions, answers}，
        // CLI 交互应答（buildAllow(updatedInput)）用完整输入执行工具（AskUserQuestion 拿到 answers）。
        // data.input 是工具原始输入 {questions:[...]}，questions 取数组本体（勿再嵌套）。
        let qInput: unknown = data.input ?? {}
        if (data.input && typeof data.input === 'object' && Array.isArray((data.input as { questions?: unknown }).questions)) {
          qInput = (data.input as { questions: unknown }).questions
        }
        const updatedInput = data.answers
          ? { questions: qInput, answers: data.answers }
          : {}
        target.send(
          JSON.stringify({
            type: 'approval-response',
            requestId: data.requestId ?? '',
            response: data.allowed === true
              ? { behavior: 'allow', updatedInput }
              : { behavior: 'deny', message: '用户拒绝了该工具调用' },
          }),
        )
      } else {
        approvalTrailPush('floria-approve-miss', data.sessionId, data.requestId, 'target-not-online')
        ws.send(
          JSON.stringify({
            type: 'status',
            state: data.sessionId ? '目标会话未在线，审批未送达' : 'approve 尚未接入（阶段2）',
          }),
        )
      }
      break
    }
    case 'subscribe': {
      // 2026-08-24 web 会话改造：实时流走 SSE（conversationDisplay 上报 + jsonl + 列表刷新），
      // 无 WS out/approval 回推；订阅保留为兼容空操作（会话存在即确认）。
      const sid = data.sessionId ?? ''
      if (!sid) break
      const p = webSessions.get(sid)
      if (p) {
        p.clients.add(ws)
        ws.send(JSON.stringify({ type: 'status', state: '已订阅会话实时流' }))
      } else {
        ws.send(JSON.stringify({ type: 'status', state: 'web 会话进程未运行，未订阅' }))
      }
      break
    }
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }))
      break
  }
}

// ============================================================================
// 生命周期
// ============================================================================
export type LocalGatewayInfo = {
  port: number
  host: string
  token: string
  lanUrl: string
  localUrl: string
}

function hasClients(): boolean {
  return cliClients.size > 0 || sockets.size > 0 || sseClients.size > 0 || webSessions.size > 0
}

// 2026-08-17 空闲自动回收：无任何客户端连接（CLI 注册 / 遥测 WS / SSE 全空）时起计时，持续
// GATEWAY_IDLE_MINUTES 分钟仍无连接 → 自动 stopLocalGateway（清空三集合 + 清盘 token）+ 退出进程。
// 任一连接增删都会调用本函数重置计时（有动静即顺延）。仅 --gateway 独立进程模式启用。
// ============================================================================
// Web 容器 backend 进程管理实现
// ============================================================================
// 端口可用性探测：短暂监听 127.0.0.1:<port>，成功即释放 → 可用
function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = netCreateServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '127.0.0.1')
  })
}

// 后端就绪探测：原生 TCP 连 127.0.0.1:<port> → 发最小 HTTP GET，2xx/404 均视为服务已起来。
// 用 node:net 而非 node:http：bun 编译产物里 httpRequest 对某些后端（aiohttp）可能 hang，
// 原生 socket 最稳（2026-08-19 实测网关 spawn ComfyUI 探测）。
function backendReady(port: number, path: string, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      try {
        sock.destroy()
      } catch {
        /* 忽略 */
      }
      resolve(ok)
    }
    const sock = netCreateConnection({ host: '127.0.0.1', port })
    let buf = ''
    sock.on('connect', () => {
      sock.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`)
    })
    sock.on('data', (d) => {
      buf += d.toString('latin1')
      const m = /^HTTP\/1\.[01] (\d{3})/.exec(buf)
      if (m) finish(m[1] === '200' || m[1] === '404')
    })
    sock.on('error', () => finish(false))
    sock.on('close', () => finish(false))
    sock.setTimeout(timeoutMs, () => finish(false))
  })
}

async function allocBackendPort(): Promise<number> {
  for (let p = BACKEND_PORT_BASE; p < BACKEND_PORT_MAX; p++) {
    if (await portFree(p)) return p
  }
  return 0
}

// 进行中的 spawn（防并发重复拉起）：同一 label 探测期间，后续请求复用同一 Promise
const backendPending = new Map<string, Promise<BackendProc>>()

function backendLogPath(label: string): string {
  const safe = label.replace(/[^a-zA-Z0-9_-]/g, '_')
  return join(getPortableRoot(), '.claude', `backend-${safe}.log`)
}

// O3：backend 日志轮转 —— 超过上限截断重写，防长期运行无限增长（stdout/stderr 落盘只追加）
const BACKEND_LOG_MAX_BYTES = 5 * 1024 * 1024
function rotateBackendLogIfNeeded(p: string): void {
  try {
    if (existsSync(p) && statSync(p).size > BACKEND_LOG_MAX_BYTES) truncateSync(p, 0)
  } catch {
    /* 忽略 */
  }
}

// 懒加载 spawn 后端进程（已运行则复用并刷新活跃时间）
async function ensureBackend(label: string, cfg: BackendCfg): Promise<BackendProc> {
  const existing = backendProcesses.get(label)
  if (existing && existing.child.exitCode === null && !existing.child.killed) {
    existing.lastActive = Date.now()
    return existing
  }
  if (existing) backendProcesses.delete(label) // 进程已退出，清理后重起
  const pending = backendPending.get(label)
  if (pending) return pending // 探测进行中，等待同一 Promise 结果（不重复 spawn）
  const p = doSpawnBackend(label, cfg)
  backendPending.set(label, p)
  try {
    return await p
  } finally {
    backendPending.delete(label)
  }
}

async function doSpawnBackend(label: string, cfg: BackendCfg): Promise<BackendProc> {
  const port = cfg.port > 0 ? cfg.port : await allocBackendPort()
  if (!port) throw new Error(`backend ${label}: 无可用端口（${BACKEND_PORT_BASE}-${BACKEND_PORT_MAX} 均被占用）`)
  const cmd = cfg.cmd.map((a) => (a.includes('{port}') ? a.replaceAll('{port}', String(port)) : a))
  // cmd[0] 若是相对路径（含 / 或 \），node spawn 按进程 cwd 而非选项 cwd 解析 → 手动 resolve 到 cfg.cwd
  if (cmd[0] && !isAbsolute(cmd[0]) && /[\\/]/.test(cmd[0])) cmd[0] = resolve(cfg.cwd, cmd[0])
  // 子进程 stdout/stderr 落盘到便携根 .claude/backend-<label>.log（stdio ignore 会丢启动报错，难诊断）
  const logPath = backendLogPath(label)
  rotateBackendLogIfNeeded(logPath)
  const logFd = openSync(logPath, 'a')
  const child = spawn(cmd[0], cmd.slice(1), {
    cwd: cfg.cwd,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', logFd, logFd],
    shell: false,
    windowsHide: true, // 2026-08-20 黑框根因修复：python.exe 是 console 子系统，不设 windowsHide 每次 spawn 会弹出黑色命令行窗口（用户「黑框=单独弹出的指令框，类似 cmd」）
  })
  const proc: BackendProc = { pid: child.pid ?? 0, port, cfg, startedAt: Date.now(), lastActive: Date.now(), child }
  child.on('exit', () => {
    try {
      closeSync(logFd)
    } catch {
      /* 忽略 */
    }
    if (backendProcesses.get(label) === proc) backendProcesses.delete(label)
  })
  // 就绪探测：最多 ~24s（冷启动慢的后端如 ComfyUI torch 初始化实测 ~22s）
  let ready = false
  for (let i = 0; i < 120; i++) {
    if (gatewayStopping || child.exitCode !== null) break
    if (await backendReady(port, cfg.readyPath)) {
      ready = true
      break
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  if (!ready) {
    try {
      child.kill()
    } catch {
      /* 忽略 */
    }
    if (child.pid) {
      try {
        spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true })
      } catch {
        /* 忽略 */
      }
    }
    throw new Error(`backend ${label}: 端口 ${port} 就绪探测失败（${cfg.readyPath}），详见日志 ${backendLogPath(label)}`)
  }
  backendProcesses.set(label, proc)
  return proc
}

function killBackend(label: string): void {
  const p = backendProcesses.get(label)
  if (!p) return
  backendProcesses.delete(label)
  try {
    p.child.kill()
  } catch {
    /* 忽略 */
  }
  // Windows 兜底：child.kill 不杀进程树，taskkill /T 连子进程一起清
  if (p.pid) {
    try {
      spawnSync('taskkill', ['/F', '/T', '/PID', String(p.pid)], { stdio: 'ignore', windowsHide: true })
    } catch {
      /* 忽略 */
    }
  }
}

function killAllBackends(): void {
  for (const label of [...backendProcesses.keys()]) killBackend(label)
}

// 空闲回收：backend 超过 idleMinutes 无活跃 → kill（独立于网关自身空闲回收，
// 因为 iframe 直连后端不经网关，网关三集合可能为空但后端仍被使用中）
function reclaimIdleBackends(): void {
  const now = Date.now()
  for (const [label, p] of [...backendProcesses]) {
    const idleMs = (p.cfg.idleMinutes ?? GATEWAY_IDLE_MINUTES) * 60 * 1000
    if (now - p.lastActive > idleMs) {
      console.log(`[gateway] backend ${label} 空闲超过 ${p.cfg.idleMinutes ?? GATEWAY_IDLE_MINUTES} 分钟，回收`)
      killBackend(label)
    }
  }
}

function scheduleBackendReclaim(): void {
  if (!ENABLE_IDLE_RECLAIM || backendReclaimTimer) return
  backendReclaimTimer = setInterval(reclaimIdleBackends, 60 * 1000)
  backendReclaimTimer.unref?.()
}

// ============================================================================
// Web 独立会话实现（2026-08-24 改造：本地可见交互 REPL 窗口，替代 headless 管道转发）
// ============================================================================

/**
 * spawn 一个「本地可见交互 REPL 窗口」作为 web 独立会话（2026-08-24 改造，替代 headless）。
 *
 * 与 headless 的区别：
 *  - 不再传 -p/stream-json（headless 打印模式），改为交互 REPL（正常 ink UI + 终端窗口），
 *    用户在本地可见窗口里可以直接看/操作（审批也在本地窗口弹）。
 *  - 通信不再走 stdin/stdout 管道：交互 REPL 启动后由 CLI 侧 gatewayClient 连 /clients 注册
 *    sessionId（interactiveHelpers.renderAndRun → startGatewayProbeAndConnect），web 消息经
 *    cliClients 精确路由注入 REPL（gatewayClient enqueue，与本地打字同路径）；
 *    展示走 conversationDisplay 上报（/api/conversation）+ jsonl 落盘 + SSE 列表刷新。
 *  - 窗口通过 PowerShell Start-Process -PassThru 弹出（复用 deepLink/terminalLauncher 的
 *    可见终端思路；-PassThru 返回真实 CLI pid 供 stopWebSession taskkill）。
 *
 * resume 提供 → 恢复已有会话（--resume <id>）；否则新会话由网关预分配 UUID 经 --session-id
 * 传给子进程（main.tsx 支持 --session-id <uuid>：'Use a specific session ID for the
 * conversation (must be a valid UUID)'），CLI 转录 init 首行即带该 id，jsonl 落盘
 * <项目根>/.claude/projects/<id>.jsonl。
 * project 提供（2026-08-24）→ 在指定项目下新建/恢复会话（cwd = 该项目根）；未指定 → 默认项目根。
 * resolve 在 CLI 完成 /clients 注册后返回 sessionId（保证 web 首条消息可注入，不丢消息）；
 * 注册超时（CLI 启动失败/网关未探测到）→ reject。
 */
function spawnWebSession(resume?: string, project?: string): Promise<string> {
  // 幂等：resume 的会话进程已在跑（前端切走再切回）→ 复用现有进程，不重复 spawn（双进程会双写同一 jsonl）
  if (resume && webSessions.has(resume)) {
    const existing = webSessions.get(resume)
    if (existing) existing.lastActive = Date.now()
    return Promise.resolve(resume)
  }
  // resume 未显式指定项目时，按注册表里该会话的记录定位项目（项目会话切回后仍落在原项目）
  let effectiveProject = project
  if (resume && !effectiveProject) {
    const reg = loadWebSessionRegistry()
    effectiveProject = reg.projects[resume]
  }
  return new Promise((resolve, reject) => {
    const sid = resume ?? randomUUID()
    const args = resume ? ['--resume', resume] : ['--session-id', sid]
    // cwd = 项目根（指定项目 → 该项目根）：会话 jsonl 落盘到 <项目根>/.claude/projects/<sessionId>.jsonl（与 CLI 同目录）
    const cwd = webSessionProjectRoot(effectiveProject)
    // 可见交互窗口：PowerShell Start-Process -PassThru（console 程序默认开新终端窗口，stdio 连窗口）。
    // 单引号 PS 字符串无转义（仅 '' 表示字面 '），复用 terminalLauncher.psQuote 同款策略。
    const psQuote = (s: string): string => `'${s.replace(/'/g, "''")}'`
    // 2026-08-24 用户定案：exe 按会话来源选择——笔（无 project）= 全局根下 cli-dev exe；
    // 项目 = 项目目录内 cli-dev exe；未找到 → 回退网关自身 exe。
    const exe = webSessionExe(effectiveProject)
    // 注入 FLOIRA_GATEWAY（CLI 探测网关地址；网关换过端口时回退 127.0.0.1:8124 会探测失败）
    const gwUrl = `http://127.0.0.1:${currentPort}`
    const ps = [
      `$env:FLOIRA_GATEWAY = ${psQuote(gwUrl)};`,
      `$p = Start-Process -FilePath ${psQuote(exe)} -ArgumentList ${args.map(psQuote).join(',')} -WorkingDirectory ${psQuote(cwd)} -PassThru;`,
      'Write-Output $p.Id',
    ].join(' ')
    let child: import('node:child_process').ChildProcess
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
        windowsHide: true, // powershell 中转进程本身隐藏，窗口由 Start-Process 弹出的 CLI 持有
        stdio: ['ignore', 'pipe', 'ignore'],
      })
    } catch (e) {
      reject(e as Error)
      return
    }
    // 解析 Start-Process -PassThru 输出的真实 CLI pid（用于 stopWebSession taskkill）
    let outBuf = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      outBuf += chunk
    })
    child.on('error', (err) => {
      reject(err)
    })
    // 等 CLI 完成 /clients 注册（cliClients.has(sid)）——注册成功即 resolve；
    // 超时（CLI 启动失败/未能探测到网关）→ 清理并 reject。
    const startedAt = Date.now()
    const REGISTER_TIMEOUT_MS = 20_000
    const timer = setInterval(() => {
      if (cliClients.has(sid)) {
        clearInterval(timer)
        const cliPid = Number(outBuf.trim())
        const proc: WebSessionProc = {
          sessionId: sid,
          child,
          pid: cliPid || undefined,
          clients: new Set(),
          startedAt,
          lastActive: Date.now(),
        }
        webSessions.set(sid, proc)
        const reg = loadWebSessionRegistry()
        reg.ids.add(sid)
        // 2026-08-24 记录会话来源项目（resume 时按 cwd 定位）：笔会话（无 project）不写 →
        // resume 时 effectiveProject=undefined → cwd=全局根（散装）；项目会话记项目 label → cwd=该项目根
        if (effectiveProject) reg.projects[sid] = effectiveProject
        else delete reg.projects[sid]
        saveWebSessionRegistry(reg.ids, reg.projects)
        resolve(sid)
        return
      }
      if (Date.now() - startedAt > REGISTER_TIMEOUT_MS) {
        clearInterval(timer)
        try {
          if (child.pid && isPidAlive(child.pid)) spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true })
        } catch {
          /* 忽略 */
        }
        reject(new Error(`web 会话启动超时（${REGISTER_TIMEOUT_MS / 1000}s 内未完成网关注册）`))
      }
    }, 300)
    // powershell 中转进程 spawn 完 CLI 即退出——它退出不代表 CLI 窗口关闭。
    // 不在此清 timer（CLI 可能尚未注册 /clients）；若 powershell 本身失败（stderr 报错/非 0 退出
    // 且未产出 pid）→ 提前 reject，避免空等 20s。
    child.on('exit', (code) => {
      const cliPid = Number(outBuf.trim())
      if (code !== 0 && !cliPid && !webSessions.has(sid)) {
        clearInterval(timer)
        reject(new Error(`打开本地 CLI 窗口失败（powershell exit ${code ?? '?'}）`))
      }
    })
    child.on('error', (err) => {
      clearInterval(timer)
      reject(err)
    })
  })
}

// 2026-08-24 web 会话改造：web 消息经 cliClients 注入（CLI 侧 gatewayClient enqueue），
// 审批在本地窗口操作 → 原 stdin 管道函数 sendWebSessionMessage/handleWebApproval 已删除。

/** 优雅停 web 会话：关闭本地可见 CLI 窗口（taskkill 真实 CLI pid 树，窗口随之关闭） */
function stopWebSession(sessionId: string): boolean {
  const p = webSessions.get(sessionId)
  if (!p) return false
  webSessions.delete(sessionId)
  const pid = p.pid ?? p.child.pid
  if (pid && isPidAlive(pid)) {
    try {
      spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true })
    } catch {
      /* 忽略 */
    }
  }
  return true
}

function killAllWebSessions(): void {
  for (const sid of [...webSessions.keys()]) stopWebSession(sid)
}

// 空闲回收：web 会话（本地可见交互 CLI 窗口）生命周期由用户本地操作决定——进程活着不回收
// （lastActive 只是网关侧活跃，本地窗口用户可能正直接操作）；仅清理「进程已死」的残留注册。
function reclaimIdleWebSessions(): void {
  for (const [sid, p] of [...webSessions]) {
    if (p.pid && !isPidAlive(p.pid)) {
      console.log(`[gateway] web 会话 ${sid} CLI 进程已退出，清理运行注册`)
      webSessions.delete(sid)
    }
  }
}

function scheduleWebReclaim(): void {
  if (!ENABLE_IDLE_RECLAIM || webReclaimTimer) return
  webReclaimTimer = setInterval(reclaimIdleWebSessions, 60 * 1000)
  webReclaimTimer.unref?.()
}

function scheduleIdleShutdown(): void {
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  if (!ENABLE_IDLE_RECLAIM || hasClients()) return
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (hasClients()) return // 计时期间已有连接，放弃回收
    console.log(`[gateway] 无任何客户端连接，空闲超过 ${GATEWAY_IDLE_MINUTES} 分钟，自动关闭`)
    stopLocalGateway()
    process.exit(0)
  }, GATEWAY_IDLE_MINUTES * 60 * 1000)
  idleTimer.unref?.()
}

export function startLocalGateway(opts?: { host?: string; port?: number; token?: string }): LocalGatewayInfo {
  gatewayStopping = false
  if (server) {
    const lan = lanAddress()
    return {
      port: currentPort,
      host: currentHost,
      token: currentToken,
      lanUrl: lan ? `http://${lan}:${currentPort}/?token=${currentToken}` : '',
      localUrl: `http://127.0.0.1:${currentPort}/?token=${currentToken}`,
    }
  }
  currentHost = opts?.host || process.env.GATEWAY_HOST || '0.0.0.0'
  currentPort = Number(opts?.port || process.env.GATEWAY_PORT || 8124)
  currentToken = opts?.token || process.env.SERVER_TOKEN || randomBytes(16).toString('hex')
  // 共享 token：CLI 侧上报（conversationDisplay.ts /api/conversation、/api/activity）据此附加校验参数。
  // 2026-08-17 网关独立化：token 落盘（便携根 .claude/gateway-token），供其它 CLI 进程读取后
  // 向本网关上报 / 连接 /clients（否则非网关宿主的 CLI 无 token，上报会被 401 拒绝）。
  setGatewayToken(currentToken)
  saveGatewayTokenToDisk(currentToken)
  const root = getPortableRoot()
  // 启动即挂上空闲回收计时：此时无任何连接，若后续一直无人使用，到点自动关闭
  scheduleIdleShutdown()
  // 2026-08-19 Web 容器：backend 进程空闲回收（独立于网关自身，仅 --gateway 独立进程模式）
  scheduleBackendReclaim()
  // 2026-08-23 web 独立会话：headless 子进程空闲回收
  scheduleWebReclaim()

  server = createServer((req, res) => handleRequest(req, res, root))
  wss = new WebSocketServer({ noServer: true })
  wss.on('connection', (ws) => {
    sockets.add(ws)
    scheduleIdleShutdown()
    broadcast({ type: 'status', state: 'connected' })
    ws.on('message', (data) => {
      handleWsMessage(ws, data.toString())
    })
    ws.on('close', () => {
      sockets.delete(ws)
      detachWebSessionClient(ws) // 2026-08-24 订阅修复：断开即摘除 web 会话订阅
      scheduleIdleShutdown()
    })
    ws.on('error', () => {
      sockets.delete(ws)
      detachWebSessionClient(ws)
      scheduleIdleShutdown()
    })
  })
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`)
    if (url.searchParams.get('token') !== currentToken) {
      socket.destroy()
      return
    }
    if (url.pathname === '/ws') {
      // 遥测端（浏览器 floria）连接
      wss?.handleUpgrade(req, socket, head, (ws) => {
        wss?.emit('connection', ws, req)
      })
      return
    }
    if (url.pathname === '/clients') {
      // 2026-08-17 CLI 进程客户端：query 带 session=<uuid>，注册进 cliClients，
      // 遥测端消息经 send 分支转发过来，由 CLI 侧注入其 REPL。不 emit wss 'connection'
      // （不进遥测 broadcast 集合，避免遥测状态误发给 CLI）。
      const sid = url.searchParams.get('session') || ''
      if (!sid) {
        socket.destroy()
        return
      }
      wss?.handleUpgrade(req, socket, head, (ws) => {
        const prev = cliClients.get(sid)
        if (prev && prev !== ws) {
          try {
            prev.close()
          } catch {
            /* 忽略 */
          }
        }
        cliClients.set(sid, ws)
        approvalTrailPush('cli-register', sid)
        scheduleIdleShutdown()
        // 2026-08-24 审批双操作（web 与 CLI 均可）：CLI 交互权限弹窗经 /clients 上报审批请求，
        // 网关转 floria 审批卡；本地先操作/请求撤销 → 通知 floria 撤卡。
        ws.on('message', (data) => {
          let m: {
            type?: string
            requestId?: string
            toolName?: string
            input?: unknown
            toolUseId?: string
            description?: string
            suggestions?: unknown
            blockedPath?: string
            response?: unknown
          }
          try {
            m = JSON.parse(data.toString())
          } catch {
            return
          }
          // 2026-08-24 中继握手：记录 CLI 是否带审批/提问中继代码（relay:true = 新代码）
          if (m.type === 'cli-hello') {
            approvalTrailPush('cli-hello', sid, undefined, m.relay === true ? 'relay-on' : 'relay-off')
            return
          }
          if (m.type === 'approval-request' && m.requestId) {
            approvalTrailPush('cli-approval-request', sid, m.requestId, m.toolName)
            broadcast({
              type: 'approval',
              session_id: sid,
              requestId: m.requestId,
              toolName: m.toolName,
              toolUseId: m.toolUseId,
              input: m.input,
            })
            approvalTrailPush('gw-broadcast-approval', sid, m.requestId, `sockets=${sockets.size}`)
            return
          }
          // 本地（CLI 终端/窗口）已操作（allow/deny/abort）或请求已解决 → floria 撤卡
          if ((m.type === 'approval-local-resolved' || m.type === 'approval-cancel') && m.requestId) {
            approvalTrailPush('cli-local-resolved-or-cancel', sid, m.requestId, m.type)
            broadcast({ type: 'approval-dismiss', session_id: sid, requestId: m.requestId })
            return
          }
        })
        const detach = () => {
          if (cliClients.get(sid) === ws) cliClients.delete(sid)
          // 2026-08-24 web 会话：CLI 窗口被用户关闭 → 进程死亡 → 从运行表移除
          // （registry 保留，列表仍标记 kind:'web'，resume 时重新开窗口）。
          // 仅进程真死才删（gatewayClient 断线重连期间进程仍活着，不能误删）。
          const wp = webSessions.get(sid)
          if (wp && wp.pid && !isPidAlive(wp.pid)) webSessions.delete(sid)
          scheduleIdleShutdown()
        }
        ws.on('close', detach)
        ws.on('error', detach)
        ws.send(JSON.stringify({ type: 'registered', session: sid }))
      })
      return
    }
    socket.destroy()
  })
  server.on('error', (err) => {
    // 端口被占等错误：关闭对象避免悬挂
    if (server) {
      server.close()
      server = null
    }
    console.error(`[gateway] 启动失败: ${(err as Error).message}`)
  })
  server.listen(currentPort, currentHost, () => {
    console.log(`[gateway] 内置网关监听 http://${currentHost}:${currentPort} (token=${currentToken})`)
  })

  const lan = lanAddress()
  return {
    port: currentPort,
    host: currentHost,
    token: currentToken,
    lanUrl: lan ? `http://${lan}:${currentPort}/?token=${currentToken}` : '',
    localUrl: `http://127.0.0.1:${currentPort}/?token=${currentToken}`,
  }
}

export function stopLocalGateway(): boolean {
  gatewayStopping = true
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  stopSseWatches()
  // 2026-08-19 Web 容器：停网关时一并 kill 全部 backend 子进程 + 停回收 timer
  if (backendReclaimTimer) {
    clearInterval(backendReclaimTimer)
    backendReclaimTimer = null
  }
  killAllBackends()
  // 2026-08-23 web 独立会话：停网关时一并关停全部 headless 子进程 + 停回收 timer
  if (webReclaimTimer) {
    clearInterval(webReclaimTimer)
    webReclaimTimer = null
  }
  killAllWebSessions()
  for (const c of sockets) {
    try {
      c.close()
    } catch {
      /* 忽略 */
    }
  }
  sockets.clear()
  // 2026-08-17 独立化：一并断开所有 CLI 客户端（它们会各自重连或静默等待）
  for (const c of cliClients.values()) {
    try {
      c.close()
    } catch {
      /* 忽略 */
    }
  }
  cliClients.clear()
  sseClients.clear()
  sseSizes.clear()
  ssePrimed = false
  // C1 修复：停网关时一并清空 CLI 上报的内存缓存（内存数据本就随网关重启失效）
  conversationDisplays.clear()
  sessionActivity.clear()
  sessionModels.clear()
  // 共享 token 一并清空：网关停止后 CLI 上报不再附加（保持静默失败，不报错）。
  // 2026-08-17 独立化：同时清盘 token 文件，避免遗留的 token 被误用（新一轮网关会重新生成写盘）。
  setGatewayToken('')
  clearGatewayTokenFromDisk()
  try {
    wss?.close()
  } catch {
    /* 忽略 */
  }
  wss = null
  if (server) {
    server.close()
    server = null
    return true
  }
  return false
}

export function isLocalGatewayRunning(): boolean {
  return !!server
}

/** 当前内置网关 token（未启动时返回空串）。用于 /server 回显已运行网关的访问 URL。 */
export function getLocalGatewayToken(): string {
  return currentToken
}
