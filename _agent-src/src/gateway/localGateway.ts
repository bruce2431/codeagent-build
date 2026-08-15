/**
 * localGateway.ts —— 内置私有化网关（进程内，feature: PRIVATE_GATEWAY）
 *
 * 由 /server 命令开关。与旧形态（SubPj2-私有化网关/server/gateway.mjs 独立进程 + spawn
 * cli-dev.exe --print 子进程）不同：本模块直接跑在 CLI 进程内，遥测端消息经 WS 到达后
 * 通过 messageQueueManager.enqueue 注入本进程 REPL 队列——与打字完全同一条路径，
 * 无需子进程、无跨进程同步、无 AGENT_CWD。会话转录落盘由 REPL 现有机制天然完成，
 * 落在 CLI 当前项目根 .claude/projects/（目录隔离自动满足）。
 *
 * 复用已有实现：
 *  - 会话展示由 CLI 侧 conversationDisplay.ts 导出（POST /api/conversation），/api/session
 *    命中时优先返回 display；此处 jsonl 兜底读取仅用于 CLI 未导出的情况。
 *  - 注入路径与 useReplBridge.handleInboundMessage 相同：enqueue({mode:'prompt', bridgeOrigin:true})。
 *
 * HTTP/WS 用 node:http + ws（已验证可打包进 bun 编译产物），不依赖 Bun.serve。
 */
import { createServer, type Server } from 'node:http'
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, resolve, extname, basename, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { WebSocketServer, WebSocket } from 'ws'
import { getPortableRoot } from '../utils/envUtils.js'
import { getProjectRoot } from '../bootstrap/state.js'
import {
  extractFirstPromptFromHead,
  extractJsonStringField,
  extractLastJsonStringField,
  readSessionLite,
} from '../utils/sessionStoragePortable.js'
import { filterConversationForDisplay } from '../utils/conversationDisplay.js'
import { webAssets } from './web-assets.generated.js'
import { enqueue } from '../utils/messageQueueManager.js'
import type { QueuedCommand } from '../types/textInputTypes.js'

// ============================================================================
// 状态
// ============================================================================
let server: Server | null = null
let wss: WebSocketServer | null = null
let currentToken = ''
let currentHost = '0.0.0.0'
let currentPort = 8124
const sockets = new Set<WebSocket>()
const sseClients = new Set<{ res: import('node:http').ServerResponse }>()
let sseTimer: NodeJS.Timeout | null = null
let ssePrimed = false
const sseSizes = new Map<string, { size: number; mtime: number }>()

// CLI 侧 conversationDisplay.ts 上报的展示结果（内存，进程退出即消失）
const conversationDisplays = new Map<string, { messages: unknown[]; updatedAt: number }>()
// CLI 侧 sendSessionActivity 上报的活动状态（内存，进程退出即消失）
const sessionActivity = new Map<string, { status: string; pid: number; cwd?: string; updatedAt: number }>()
// C1 修复：两个内存 Map 无上限（只增不删）→ 长跑泄漏。加 TTL + 死进程惰性清扫。
const DISPLAY_TTL_MS = 10 * 60 * 1000 // conversationDisplays 10 分钟无刷新视为过期
const ACTIVITY_TTL_MS = 10 * 60 * 1000 // sessionActivity 10 分钟无上报视为过期

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
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

// ============================================================================
// 会话列表 / 读取（基于便携根扫描；逻辑对齐旧 gateway.mjs）
// ============================================================================
const SESSION_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/i

function findProjects(root: string): Array<{ label: string; dir: string; scope: string }> {
  const groups: Array<{ label: string; dir: string; scope: string }> = []
  const global = join(root, '.claude', 'projects')
  if (isDir(global)) groups.push({ label: '全局根 · 散装对话', dir: global, scope: 'global' })
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
    if (isDir(pd)) groups.push({ label: e.name, dir: pd, scope: 'project' })
  }
  return groups
}

const truncate = (s: string, n: number): string => {
  s = (s || '').trim().replace(/\s+/g, ' ')
  return s.length > n ? s.slice(0, n) + '…' : s
}

function countUserAssistant(text: string): number {
  let n = 0
  for (const line of text.split('\n')) {
    if (line.includes('"type":"user"') || line.includes('"type":"assistant"')) n++
  }
  return n
}

type SessionMeta = { sidechain: true } | { title: string; messageCount: number; updatedAt: number }

async function parseMeta(file: string): Promise<SessionMeta | null> {
  const lite = await readSessionLite(file)
  if (!lite) return null
  const { head, tail, mtime } = lite
  if (head.includes('"isSidechain":true') || head.includes('"isSidechain": true')) return { sidechain: true }
  const teamName = extractJsonStringField(head, 'teamName')
  if (teamName) return { sidechain: true }
  const title = extractLastJsonStringField(tail, 'customTitle') || extractLastJsonStringField(head, 'customTitle') || ''
  const messageCount =
    countUserAssistant(head) + (tail === head ? 0 : countUserAssistant(tail))
  if (title) {
    return { title, messageCount, updatedAt: mtime }
  }
  // 无 customTitle：从 head 块提取首个有效用户消息作标题（复用 CLI 权威
  // extractFirstPromptFromHead，不再全文件 readFileSync 逐行 JSON.parse）
  const first = extractFirstPromptFromHead(head)
  return {
    title: first ? truncate(first, 60) : '（空会话）',
    messageCount,
    updatedAt: mtime,
  }
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
}

async function listSessions(root: string) {
  sweepStaleMaps()
  const groups = findProjects(root)
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
      const act = sessionActivity.get(f.replace(/\.jsonl$/, ''))
      const state = act && isPidAlive(act.pid) ? act.status : null
      sessions.push({
        id: Buffer.from(p).toString('base64url'),
        projectLabel: g.label,
        projectScope: g.scope,
        file: basename(p),
        title: meta.title,
        messageCount: meta.messageCount,
        updatedAt: meta.updatedAt,
        state,
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

function readSession(id: string, root: string) {
  const { path: p } = decodeSessionPath(id, root)
  const raw = readFileSync(p, 'utf8')
  const records: Record<string, unknown>[] = []
  for (const line of raw.split('\n')) {
    const s = line.trim()
    if (!s) continue
    try {
      records.push(JSON.parse(s))
    } catch {
      /* 跳过坏行 */
    }
  }
  // 复用 CLI 权威过滤（conversationDisplay.filterConversationForDisplay），
  // 与 CLI 上报的 display 同源，不再本地复刻 isSynth/toBlocks 等逻辑。
  const messages = filterConversationForDisplay(records as never, 'transcript')
  return { file: basename(p), path: p, messages }
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
// SSE 实时事件（jsonl 变化轮询）
// ============================================================================
function pollSse(root: string): void {
  if (sseClients.size === 0) {
    if (sseTimer) {
      clearInterval(sseTimer)
      sseTimer = null
    }
    return
  }
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
async function handleRequest(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, root: string): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`)
  if (req.method === 'GET' && url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
    res.end(JSON.stringify({ ok: true, mode: 'gateway', workspace: root, public: publicDir(root), webAssets: Object.keys(webAssets).length }))
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/sessions') {
    try {
      const data = await listSessions(root)
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
      res.end(JSON.stringify(data))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: String((e && (e as Error).message) || e) }))
    }
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/plugins') {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
      res.end(JSON.stringify(listPlugins(root)))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: String((e && (e as Error).message) || e) }))
    }
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/session') {
    const id = url.searchParams.get('id')
    if (!id) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'missing id' }))
      return
    }
    try {
      const { path: p, uuid } = decodeSessionPath(id, root)
      // CLI 已上报 display 时直接返回，跳过 jsonl 全量解析
      const disp = conversationDisplays.get(uuid)
      if (disp) {
        const data = { file: basename(p), path: p, messages: disp.messages, display: disp.messages }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
        res.end(JSON.stringify(data))
        return
      }
      const data = readSession(id, root)
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
      res.end(JSON.stringify(data))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: String((e && (e as Error).message) || e) }))
    }
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/conversation') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}')
        const sid = String(parsed?.sessionId || '')
        const msgs = Array.isArray(parsed?.messages) ? parsed.messages : null
        if (sid && msgs) {
          conversationDisplays.set(sid, { messages: msgs, updatedAt: Date.now() })
          sweepStaleMaps()
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true }))
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: 'invalid body' }))
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: String((e && (e as Error).message) || e) }))
      }
    })
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/activity') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}')
        const sid = String(parsed?.sessionId || '')
        const status = ['busy', 'idle', 'waiting'].includes(parsed?.status) ? parsed.status : null
        if (sid && status) {
          sessionActivity.set(sid, {
            status,
            pid: Number(parsed.pid) || 0,
            cwd: parsed.cwd ? String(parsed.cwd) : undefined,
            updatedAt: Date.now(),
          })
          sweepStaleMaps()
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: true }))
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: 'invalid body' }))
        }
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: String((e && (e as Error).message) || e) }))
      }
    })
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
    res.write(`data: ${JSON.stringify({ type: 'hello', time: Date.now() })}\n\n`)
    req.on('close', () => sseClients.delete(client))
    if (!sseTimer) sseTimer = setInterval(() => pollSse(root), 2000)
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
  if (!file.startsWith(pub) || !existsSync(file) || !statSync(file).isFile()) {
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

function handleWsMessage(ws: WebSocket, raw: string): void {
  let data: { type?: string; text?: string; requestId?: string; allowed?: boolean }
  try {
    data = JSON.parse(raw)
  } catch {
    return
  }
  switch (data.type) {
    case 'send': {
      const text = data.text ?? ''
      if (!text.trim()) break
      // 与打字同路径注入 REPL 队列（复用 messageQueueManager.enqueue，同 useReplBridge）
      enqueue({
        value: text,
        mode: 'prompt',
        skipSlashCommands: true,
        bridgeOrigin: true,
      } as QueuedCommand)
      broadcast({ type: 'status', state: `已注入: ${text.slice(0, 60)}` })
      break
    }
    case 'approve': {
      // TODO(阶段2)：接入 REPL 权限响应（replBridgePermissionCallbacks 等价机制）
      broadcast({ type: 'status', state: 'approve 尚未接入（阶段2）' })
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

export function startLocalGateway(opts?: { host?: string; port?: number; token?: string }): LocalGatewayInfo {
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
  const root = getPortableRoot()

  server = createServer((req, res) => handleRequest(req, res, root))
  wss = new WebSocketServer({ noServer: true })
  wss.on('connection', (ws) => {
    sockets.add(ws)
    broadcast({ type: 'status', state: 'connected' })
    ws.on('message', (data) => {
      handleWsMessage(ws, data.toString())
    })
    ws.on('close', () => sockets.delete(ws))
    ws.on('error', () => sockets.delete(ws))
  })
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`)
    if (url.pathname !== '/ws' || url.searchParams.get('token') !== currentToken) {
      socket.destroy()
      return
    }
    wss?.handleUpgrade(req, socket, head, (ws) => {
      wss?.emit('connection', ws, req)
    })
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
  if (sseTimer) {
    clearInterval(sseTimer)
    sseTimer = null
  }
  for (const c of sockets) {
    try {
      c.close()
    } catch {
      /* 忽略 */
    }
  }
  sockets.clear()
  sseClients.clear()
  sseSizes.clear()
  ssePrimed = false
  // C1 修复：停网关时一并清空 CLI 上报的内存缓存（内存数据本就随网关重启失效）
  conversationDisplays.clear()
  sessionActivity.clear()
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
