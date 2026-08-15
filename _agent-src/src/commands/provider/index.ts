import type { Command, LocalCommandCall } from '../../types/command.js'
import {
  listProviders,
  switchProvider,
  addProvider,
  removeProvider,
  getActiveProviderConfig,
  loadCredentials,
} from '../../utils/credentials/pool.js'

const call: LocalCommandCall = async (args) => {
  const trimmed = args.trim()

  // No args: list providers
  if (!trimmed) {
    const creds = loadCredentials()
    const providers = Object.keys(creds.providers)

    if (providers.length === 0) {
      return {
        type: 'text',
        value: 'No providers configured. Use /provider add <name> <baseUrl> to add one.\n\nUsage:\n  /provider                     List providers\n  /provider <name>              Switch to provider\n  /provider add <name> <url>    Add provider\n  /provider remove <name>       Remove provider',
      }
    }

    const lines: string[] = ['Providers:']
    for (const name of providers) {
      const cfg = creds.providers[name]
      const active = name === creds.activeProvider
      const keyCount = cfg.keys.length
      const usable = cfg.keys.filter(k => !k.exhausted).length
      const marker = active ? '▶' : ' '
      lines.push(
        ` ${marker} ${name.padEnd(16)} [${usable}/${keyCount} keys, model: ${cfg.activeModel || '—'}]`,
      )
    }

    return { type: 'text', value: lines.join('\n') }
  }

  // Parse subcommand
  const parts = trimmed.split(/\s+/)
  const sub = parts[0]?.toLowerCase()

  if (sub === 'add' && parts.length >= 3) {
    const name = parts[1]!
    const baseUrl = parts.slice(2).join(' ')
    addProvider(name, {
      baseUrl,
      keys: [],
      activeKeyIndex: 0,
      models: [],
      activeModel: '',
    })
    return { type: 'text', value: `Added provider: ${name}` }
  }

  if (sub === 'remove' && parts.length >= 2) {
    const name = parts[1]!
    if (removeProvider(name)) {
      return { type: 'text', value: `Removed provider: ${name}` }
    }
    return { type: 'text', value: `Provider not found: ${name}` }
  }

  // Try to switch to provider
  if (switchProvider(sub)) {
    const cfg = getActiveProviderConfig()
    return {
      type: 'text',
      value: `Switched to provider: ${sub}${cfg?.activeModel ? ` (model: ${cfg.activeModel})` : ''}`,
    }
  }

  return { type: 'text', value: `Unknown provider or command: ${trimmed}\nTry: /provider add <name> <baseUrl>` }
}

const provider = {
  type: 'local',
  name: 'provider',
  description: 'List and switch API providers (from credential pool)',
  supportsNonInteractive: true,
  argumentHint: '[name | add | remove]',
  load: () => Promise.resolve({ call }),
} satisfies Command

export default provider
