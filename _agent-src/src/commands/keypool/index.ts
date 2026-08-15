import type { Command, LocalCommandCall } from '../../types/command.js'
import {
  listProviders,
  loadCredentials,
  addKey,
  removeKey,
  rotateKey,
  markCurrentKeyExhausted,
  saveCredentials,
  getActiveProviderConfig,
  getModelVision,
  setModelVision,
  hasUsableKeys,
} from '../../utils/credentials/pool.js'
import {
  getVisionSource,
  modelSupportsVision,
} from '../../utils/model/vision.js'
import { createHash } from 'crypto'

// Truncate key for display: show first 8 chars
function truncateKey(key: string): string {
  if (key.length <= 12) return key
  const hash = createHash('sha256').update(key).digest('hex')
  return `${key.slice(0, 8)}...${hash.slice(0, 4)}`
}

function formatExhausted(entry: {
  value: string
  exhausted: boolean
  exhaustedAt?: number
}): string {
  if (!entry.exhausted) return ''
  if (entry.exhaustedAt) {
    const ago = Math.round((Date.now() - entry.exhaustedAt) / 60000)
    return ` (exhausted${ago > 0 ? `, ${ago}m ago` : ''})`
  }
  return ' (exhausted)'
}

const call: LocalCommandCall = async (args) => {
  const trimmed = args.trim()
  const parts = trimmed.split(/\s+/)
  const sub = parts[0]?.toLowerCase()

  // No args: show key pool status for current provider
  if (!trimmed) {
    const config = getActiveProviderConfig()
    if (!config) {
      return {
        type: 'text',
        value: 'No active provider. Use /provider to see available providers.',
      }
    }

    const lines: string[] = [
      `Provider: ${loadCredentials().activeProvider || '(none)'}`,
      `Keys: ${config.keys.length}`,
    ]
    for (let i = 0; i < config.keys.length; i++) {
      const k = config.keys[i]!
      const active = i === config.activeKeyIndex ? ' ← active' : ''
      lines.push(
        `  [${i + 1}] ${truncateKey(k.value)}${formatExhausted(k)}${active}`,
      )
    }
    lines.push(`\nModel: ${config.activeModel || '(not set)'}`)
    lines.push(`Base URL: ${config.baseUrl}`)

    // Per-model vision judgment with source.
    if (config.models.length > 0) {
      lines.push(`\nVision (当前模型识图判定):`)
      for (const model of config.models) {
        const override = getModelVision(model)
        const source = getVisionSource(model)
        const active = model === config.activeModel ? ' ← active' : ''
        const sourceLabel =
          source === 'explicit'
            ? `${override ? '显式:on' : '显式:off'}`
            : '默认非识图'
        lines.push(
          `  ${model} → ${modelSupportsVision(model) ? '识图' : '非识图'} (${sourceLabel})${active}`,
        )
      }
    }

    return { type: 'text', value: lines.join('\n') }
  }

  if (sub === 'add' && parts.length >= 2) {
    addKey(parts.slice(1).join(' '))
    return { type: 'text', value: 'Key added to current provider.' }
  }

  if (sub === 'remove' && parts.length >= 2) {
    const idx = parseInt(parts[1]!, 10) - 1 // 1-indexed for user
    if (removeKey(idx)) {
      return { type: 'text', value: `Removed key #${parts[1]}.` }
    }
    return { type: 'text', value: `Invalid key index: ${parts[1]}` }
  }

  if (sub === 'rotate') {
    const newKey = rotateKey()
    if (newKey) {
      return {
        type: 'text',
        value: `Rotated to key: ${truncateKey(newKey)}`,
      }
    }
    return { type: 'text', value: 'No usable keys left (all exhausted).' }
  }

  if (sub === 'reset') {
    const config = getActiveProviderConfig()
    if (!config) return { type: 'text', value: 'No active provider.' }
    for (const k of config.keys) {
      k.exhausted = false
      k.exhaustedAt = undefined
    }
    saveCredentials(loadCredentials()) // flush
    return { type: 'text', value: 'Key exhaustion status reset.' }
  }

  // /key vision <model> on|off|auto — explicit per-model vision override.
  if (sub === 'vision') {
    const config = getActiveProviderConfig()
    if (!config) return { type: 'text', value: 'No active provider.' }
    const model = parts[1]
    const mode = parts[2]?.toLowerCase()
    if (!model) {
      return {
        type: 'text',
        value:
          'Usage: /key vision <model> on|off|auto\n  on/off = 显式指定该模型识图/非识图\n  auto   = 清除 override，回落默认非识图',
      }
    }
    if (mode === 'on' || mode === 'off') {
      setModelVision(model, mode === 'on')
      return {
        type: 'text',
        value: `Vision override for "${model}" → ${mode === 'on' ? 'on (识图)' : 'off (非识图)'}.`,
      }
    }
    if (mode === 'auto') {
      setModelVision(model, undefined)
      return {
        type: 'text',
        value: `Vision override for "${model}" cleared → 回落默认非识图 = ${
          modelSupportsVision(model) ? '识图' : '非识图'
        }.`,
      }
    }
    return {
      type: 'text',
      value: `Usage: /key vision <model> on|off|auto. Got mode "${mode ?? '(none)'}" — use on/off/auto.`,
    }
  }

  // Try to use /key add|remove|rotate directly
  if (sub === 'add-all') {
    // Placeholder for batch add from env
    return { type: 'text', value: 'Use /key add <key> for each key.' }
  }

  return {
    type: 'text',
    value: 'Usage:\n  /key                     Show key pool status\n  /key add <key>          Add key to current provider\n  /key remove <N>         Remove key N\n  /key rotate              Rotate to next key\n  /key reset               Reset exhaustion status\n  /key vision <m> on|off|auto  Set model vision override (on/off=显式, auto=名称模式)',
  }
}

const key = {
  type: 'local',
  name: 'key',
  description: 'Manage API keys in the credential pool',
  supportsNonInteractive: true,
  argumentHint: '[add | remove | rotate | reset | vision]',
  load: () => Promise.resolve({ call }),
} satisfies Command

export default key
