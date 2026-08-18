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
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { open as fsOpen } from 'node:fs/promises'
import { join, resolve, extname, basename, sep } from 'node:path'
import { randomBytes } from 'node:crypto'
import { networkInterfaces } from 'node:os'
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
let sseTimer: NodeJS.Timeout | null = null
let ssePrimed = false
const sseSizes = new Map<string, { size: number; mtime: number }>()
// 2026-08-17 空闲自动回收：三集合（cliClients/sockets/sseClients）全空持续 GATEWAY_IDLE_MINUTES
// 分钟后自动关闭网关，避免「所有 CLI/遥测端都退出、网关空转占端口」的孤儿状态。仅 --gateway
// 独立进程模式启用（进程内模式网关随 CLI 同生共死，无孤儿问题）。阈值可用 GATEWAY_IDLE_MINUTES 调。
const GATEWAY_IDLE_MINUTES = Number(process.env.GATEWAY_IDLE_MINUTES || 10)
const ENABLE_IDLE_RECLAIM = process.argv.includes('--gateway')
let idleTimer: NodeJS.Timeout | null = null

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

function findProjects(root: string): Array<{ label: string; dir: string; scope: string; hasPreview: boolean }> {
  const groups: Array<{ label: string; dir: string; scope: string; hasPreview: boolean }> = []
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
      groups.push({ label: e.name, dir: pd, scope: 'project', hasPreview: isDir(join(root, e.name, '.claude', 'preview')) })
    }
  }
  return groups
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
        preview: g.hasPreview,
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
  return { file: basename(p), path: p, messages }
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
  return {
    workspace: root,
    model: settings.model !== undefined ? String(settings.model) : null,
    source: settingsPath,
    items: [...poolRows, ...cfgItems],
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
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
    res.end(JSON.stringify({ error: 'unauthorized' }))
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
    res.end(JSON.stringify({ ok: true, mode: 'gateway' }))
    return
  }
  // 2026-08-17 独立网关优雅关闭端点（受上方 /api/* token 校验保护）：/server off 调用。
  // 先回响应，再 stopLocalGateway + 退出进程（网关是独立 --gateway 进程，exit 即释放端口）。
  if (req.method === 'POST' && url.pathname === '/api/shutdown') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: true, stopping: true }))
    setTimeout(() => {
      stopLocalGateway()
      process.exit(0)
    }, 50)
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
  if (req.method === 'GET' && url.pathname === '/api/models') {
    try {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
      res.end(JSON.stringify(listModels(root)))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: String((e && (e as Error).message) || e) }))
    }
    return
  }
  // 默认预览页数据：/api/project?label=<项目> → 文件树 + README + 会话元信息（GitHub 仓库风格默认界面）
  if (req.method === 'GET' && url.pathname === '/api/project') {
    const pLabel = url.searchParams.get('label') || ''
    const pProj = findProjects(root).find((g) => g.scope === 'project' && g.label === pLabel)
    if (!pProj) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'project not found' }))
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
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' })
      res.end(
        JSON.stringify({
          label: pLabel,
          scope: 'project',
          hasPreview: pProj.hasPreview,
          description: deriveProjectDescription(readme, pLabel),
          files,
          readme,
          sessionCount: pSessions.length,
          sessions: pSessions,
          lastActive: pSessions.length ? (pSessions[0].updatedAt as number) : 0,
        }),
      )
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: String((e && (e as Error).message) || e) }))
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
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'project not found' }))
      return
    }
    const fDir = resolve(fProj.dir, '..', '..') // 项目根（fProj.dir = <root>/<label>/.claude/projects）
    const fAbs = resolve(fDir, fPath)
    if (fAbs !== fDir && !fAbs.startsWith(fDir + sep)) {
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'forbidden' }))
      return
    }
    if (!existsSync(fAbs) || !statSync(fAbs).isFile()) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }
    if (statSync(fAbs).size > 4 * 1024 * 1024) {
      res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'too large' }))
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
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'missing id' }))
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
    scheduleIdleShutdown()
    res.write(`data: ${JSON.stringify({ type: 'hello', time: Date.now() })}\n\n`)
    req.on('close', () => {
      sseClients.delete(client)
      scheduleIdleShutdown()
    })
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
  let data: { type?: string; text?: string; requestId?: string; allowed?: boolean; sessionId?: string }
  try {
    data = JSON.parse(raw)
  } catch {
    return
  }
  switch (data.type) {
    case 'send': {
      const text = data.text ?? ''
      if (!text.trim()) break
      // 2026-08-17 跨进程路由：遥测端消息按 sessionId 转发给对应 CLI 进程（/clients 注册的 WS）。
      // 命中目标 → 精确转发；无 sessionId/未命中 → 广播全部 CLI 客户端；无在线 CLI → status 提示。
      const target = data.sessionId ? cliClients.get(data.sessionId) : undefined
      if (target && target.readyState === WebSocket.OPEN) {
        target.send(JSON.stringify({ type: 'send', text }))
        ws.send(JSON.stringify({ type: 'status', state: `已转发给会话 ${data.sessionId}` }))
      } else if (cliClients.size) {
        for (const c of cliClients.values()) {
          try {
            c.send(JSON.stringify({ type: 'send', text }))
          } catch {
            /* 断开忽略 */
          }
        }
        ws.send(JSON.stringify({ type: 'status', state: `已广播给 ${cliClients.size} 个在线 CLI 进程` }))
      } else {
        ws.send(JSON.stringify({ type: 'status', state: '当前无在线 CLI 进程，消息未注入' }))
      }
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

function hasClients(): boolean {
  return cliClients.size > 0 || sockets.size > 0 || sseClients.size > 0
}

// 2026-08-17 空闲自动回收：无任何客户端连接（CLI 注册 / 遥测 WS / SSE 全空）时起计时，持续
// GATEWAY_IDLE_MINUTES 分钟仍无连接 → 自动 stopLocalGateway（清空三集合 + 清盘 token）+ 退出进程。
// 任一连接增删都会调用本函数重置计时（有动静即顺延）。仅 --gateway 独立进程模式启用。
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
      scheduleIdleShutdown()
    })
    ws.on('error', () => {
      sockets.delete(ws)
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
        scheduleIdleShutdown()
        const detach = () => {
          if (cliClients.get(sid) === ws) cliClients.delete(sid)
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
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
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
