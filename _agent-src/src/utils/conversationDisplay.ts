/**
 * conversationDisplay.ts —— 把「CLI 实际显示的会话」导出为结构化 JSON，供遥测查看器（SubPj1 floria）消费。
 *
 * 最根本原则（Pj16-CodeAgent构建/CLAUDE.md）：会话展示内容一律由源码侧提供，禁止在消费端复刻。
 * 本模块把 `Messages.tsx` / `Message.tsx` 渲染期的过滤逻辑提取为纯函数（唯一权威实现）：
 *   - 思考过滤：transcript 模式全局只保留最后一个 thinking（`hidePastThinking`/`lastThinkingBlockId`），
 *     prompt 模式 thinking 全隐藏（`!isTranscriptMode && !verbose → null`）。
 *   - 用户消息识别：复用 `shouldShowUserMessage`（isMeta / isVisibleInTranscriptOnly 标记）。
 * `Messages.tsx` 与 REPL 的导出共用这里，显示 = 导出，永不跑偏。
 */

import { COMMAND_MESSAGE_TAG } from '../constants/xml.js'
import { isNotEmptyMessage, normalizeMessages, shouldShowUserMessage } from './messages.js'
import { getGatewayToken } from './gatewayToken.js'

export type DisplayBlock = {
  kind: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'image'
  text?: string
  name?: string
  input?: unknown
}

export type DisplayMessage = {
  role: 'user' | 'assistant' | 'tool' | 'system'
  blocks: DisplayBlock[]
  timestamp?: number | string
}

export type DisplayMode = 'prompt' | 'transcript'

/** 宽松输入结构：与 NormalizedMessage / Message 运行时形状兼容（类型定义在缺失的 types/message.js） */
type SourceMessage = {
  type?: string
  uuid?: string
  timestamp?: number | string
  message?: {
    role?: string
    content?: Array<{ type?: string; text?: string; thinking?: string; name?: string; input?: unknown; content?: unknown }>
  }
}

/**
 * 提取自 Messages.tsx `lastThinkingBlockId` useMemo：向后扫描，返回最后一个 thinking 块的
 * `${uuid}:${j}`；遇到不带 tool_result 的 user 消息（上一回合）返回 'no-thinking'；流式思考可见时返回
 * 'streaming'（令所有已完成 thinking 隐藏）。
 */
export function computeLastThinkingBlockId(
  messages: readonly SourceMessage[],
  opts: { hidePastThinking: boolean; isStreamingThinkingVisible: boolean },
): string | null {
  if (!opts.hidePastThinking) return null
  if (opts.isStreamingThinkingVisible) return 'streaming'
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg?.type === 'assistant') {
      const content = msg.message?.content
      if (Array.isArray(content)) {
        for (let j = content.length - 1; j >= 0; j--) {
          if (content[j]?.type === 'thinking') {
            return `${msg.uuid}:${j}`
          }
        }
      }
    } else if (msg?.type === 'user') {
      const content = msg.message?.content
      const hasToolResult = Array.isArray(content) && content.some((block) => block.type === 'tool_result')
      if (!hasToolResult) return 'no-thinking'
    }
  }
  return null
}

/** 输出单个块（kind 映射 + 文本提取） */
function toDisplayBlock(b: NonNullable<SourceMessage['message']>['content'][number]): DisplayBlock | null {
  switch (b?.type) {
    case 'text':
      return { kind: 'text', text: b.text || '' }
    case 'thinking':
      return { kind: 'thinking', text: (b.thinking ?? b.text) || '' }
    case 'redacted_thinking':
      return { kind: 'thinking', text: '（加密思考）' }
    case 'tool_use':
      return { kind: 'tool_use', name: b.name || 'tool', input: b.input }
    case 'tool_result': {
      const t = b.content
      const txt =
        typeof t === 'string' ? t : Array.isArray(t) ? t.map((x) => (x && typeof x === 'object' && 'text' in x ? String(x.text) : '')).join(' ') : ''
      return { kind: 'tool_result', text: txt }
    }
    case 'image':
      return { kind: 'image' }
    default:
      return null
  }
}

/**
 * 核心过滤：把原始消息转成「CLI 实际显示的」`{role, blocks[]}`。
 * - prompt 模式：thinking 全隐藏（对齐 `Message.tsx` `!isTranscriptMode && !verbose → null`）。
 * - transcript 模式：只保留全局最后一个 thinking（对齐 `hidePastThinking` + `lastThinkingBlockId`）。
 * - 用户消息按 `shouldShowUserMessage` 识别（isMeta/isVisibleInTranscriptOnly），替代遥测端的 isSynth 复刻。
 */
/** 归一时间戳为毫秒（流式/转录可能给 ISO 字符串；网关 /api/session 也转 ms，floria 时长计算依赖数字） */
function tsMs(ts: number | string | undefined): number | undefined {
  if (typeof ts === 'string') {
    const n = Date.parse(ts)
    return Number.isFinite(n) ? n : undefined
  }
  return typeof ts === 'number' && Number.isFinite(ts) ? ts : undefined
}

export function filterConversationForDisplay(messages: readonly SourceMessage[], mode: DisplayMode): DisplayMessage[] {
  const isTranscript = mode === 'transcript'
  const normalized = normalizeMessages(messages as never).filter(isNotEmptyMessage)
  const lastId = computeLastThinkingBlockId(normalized, { hidePastThinking: isTranscript, isStreamingThinkingVisible: false })

  const out: DisplayMessage[] = []
  for (const msg of normalized) {
    const content = msg.message?.content
    if (!Array.isArray(content)) continue
    const timestamp = tsMs(msg.timestamp)

    if (msg.type === 'user') {
      if (!shouldShowUserMessage(msg, isTranscript)) continue
      const blocks: DisplayBlock[] = []
      for (const b of content) {
        const db = toDisplayBlock(b)
        // 遥测端不渲染 slash command（/xxx）：命令消息的 text 块是
        // <command-name>/xxx</command-name>… 的 XML，CLI REPL 侧由 UserCommandMessage 渲染，
        // 遥测端直接剔除（既不显示也不参与段切分）。判定对齐 CLI UserTextMessage：
        // 文本含 <command-message> 标签即命令消息（含 skill-format 技能命令）。
        if (db?.kind === 'text' && db.text && db.text.includes(`<${COMMAND_MESSAGE_TAG}>`)) continue
        if (db) blocks.push(db)
      }
      if (blocks.length) out.push({ role: 'user', blocks, timestamp })
      continue
    }

    if (msg.type === 'assistant') {
      const blocks: DisplayBlock[] = []
      for (let j = 0; j < content.length; j++) {
        const b = content[j]
        if (b.type === 'thinking') {
          if (!isTranscript) continue // prompt：不显示完成思考
          const id = `${msg.uuid}:${j}`
          if (!(lastId && id === lastId)) continue // transcript：只留全局最后一个
        } else if (b.type === 'redacted_thinking') {
          if (!isTranscript) continue // prompt：不显示完成思考；transcript 恒显示（对齐 Message.tsx）
        }
        const db = toDisplayBlock(b)
        if (db) blocks.push(db)
      }
      if (blocks.length) out.push({ role: 'assistant', blocks, timestamp })
      continue
    }

    if (msg.type === 'system') {
      const blocks: DisplayBlock[] = []
      for (const b of content) {
        const db = toDisplayBlock(b)
        if (db) blocks.push(db)
      }
      if (blocks.length) out.push({ role: 'system', blocks, timestamp })
    }
    // tool / progress / 其它：CLI 已把 tool_result 收进 user 消息，此处跳过
  }
  return out
}

/**
 * 发送过滤结果给遥测服务器（网关）。服务器地址优先环境变量 `FLOIRA_GATEWAY`，
 * 未配置时回退网关默认本地地址 `http://127.0.0.1:8124`（`/server on` 默认 0.0.0.0:8124，
 * 本机 127.0.0.1 可达）——网关没起则 POST 静默失败，不打扰本地 CLI。
 */
// 安全加固（2026-08-15）：网关 HTTP 数据接口要求 token。进程内网关启动时会把当前 token
// 写入 gatewayToken.ts（见 localGateway.startLocalGateway）；本进程上报据此附加 query。
// 网关未启动 / 未由本进程管理时 token 为空 → 不带参数，保持旧静默失败行为（不报错、不打扰）。
function gatewayApiUrl(base: string, path: string): string {
  const tok = getGatewayToken()
  const b = base.replace(/\/+$/, '')
  if (!tok) return `${b}${path}`
  return `${b}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(tok)}`
}

export async function sendConversationToServer(sessionId: string, display: DisplayMessage[]): Promise<boolean> {
  const base = process.env.FLOIRA_GATEWAY || 'http://127.0.0.1:8124'
  try {
    const res = await fetch(gatewayApiUrl(base, '/api/conversation'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, messages: display }),
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

/** 组合入口：过滤 + 发送一步完成，返回过滤结果（REPL 渲染处调用）。 */
export async function exportConversationToServer(
  messages: readonly SourceMessage[],
  sessionId: string,
  mode: DisplayMode,
): Promise<DisplayMessage[]> {
  const display = filterConversationForDisplay(messages, mode)
  await sendConversationToServer(sessionId, display)
  return display
}

// ---------- 会话活动状态上报（PID 情况只发送、不落盘）----------
// 参考 sendConversationToServer 模式：复用 FLOIRA_GATEWAY 通道 POST /api/activity，
// 网关在内存维护「当前打开的会话 + 运行/暂停状态」，前端据此显示绿/红点。
// 不写任何盘：concurrentSessions.ts 的 PID 写盘逻辑（registerSession/updateSessionActivity）
// 保持原样，此处只做「发送」。FLOIRA_GATEWAY 未配置时回退本地网关 127.0.0.1:8124
// （/server on 默认绑定 0.0.0.0:8124，本机 127.0.0.1 可达）；网关没起则 POST 静默失败。

export type SessionActivityStatus = 'busy' | 'idle' | 'waiting'

/**
 * 上报当前会话活动状态给网关（内存汇总、不落盘）。网关 /api/sessions 据此给每个会话附
 * `state`：busy=绿点（正在运行），idle/waiting=红点（运行暂停），无记录/进程退出=无点。
 * fire-and-forget，失败静默。
 */
export async function sendSessionActivity(
  sessionId: string,
  activity: { status: SessionActivityStatus; pid: number; cwd?: string },
): Promise<boolean> {
  const base = process.env.FLOIRA_GATEWAY || 'http://127.0.0.1:8124'
  if (!base) return false
  try {
    const res = await fetch(gatewayApiUrl(base, '/api/activity'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, ...activity }),
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}
