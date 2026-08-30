/**
 * Credential pool — multi-provider, multi-key, multi-model management.
 *
 * Provides the runtime API for all credential operations:
 * - Reading/writing the credentials.json file
 * - Getting the active API key, base URL, model
 * - Switching provider, key, model
 * - Key rotation and exhaustion tracking
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { safeParseJSON } from '../json.js'
import type {
  ApiKeyEntry,
  CredentialsFile,
  ProviderConfig,
} from './types.js'

const CREDENTIALS_FILENAME = 'credentials.json'

// ── Internal helpers ─────────────────────────────────────────────────────────

function _getCredentialsPath(): string {
  return join(getClaudeConfigHomeDir(), CREDENTIALS_FILENAME)
}

function createDefaultCredentials(): CredentialsFile {
  return {
    activeProvider: '',
    providers: {},
  }
}

const CREDENTIALS_ENCODING = 'utf-8' as const

function writeCredentials(creds: CredentialsFile): void {
  const path = _getCredentialsPath()
  const dir = getClaudeConfigHomeDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(path, JSON.stringify(creds, null, 2), CREDENTIALS_ENCODING)
  // safeParseJSON memoizes by content string and loadCredentials hands back a
  // reference into the cached object (mutation-through-reference is relied upon
  // by callers like /key reset). If a write reverts the file to content that was
  // cached earlier, the next read returns the stale mutated object — e.g. setting
  // then clearing /key vision reverts credentials.json to the original bytes, so
  // the override silently persists in memory. Writes are rare and the file is
  // small, so invalidating the parse cache after each write is correct & cheap.
  safeParseJSON.cache.clear()
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Load credentials from disk. Returns default (empty) if file doesn't exist.
 */
export function loadCredentials(): CredentialsFile {
  const path = _getCredentialsPath()
  if (!existsSync(path)) {
    return createDefaultCredentials()
  }
  try {
    const raw = readFileSync(path, CREDENTIALS_ENCODING)
    const parsed = safeParseJSON(raw)
    if (!parsed || typeof parsed !== 'object') {
      return createDefaultCredentials()
    }
    const data = parsed as Record<string, unknown>
    return {
      activeProvider: typeof data.activeProvider === 'string' ? data.activeProvider : '',
      providers: (typeof data.providers === 'object' && data.providers !== null
        ? data.providers
        : {}) as Record<string, ProviderConfig>,
    }
  } catch {
    return createDefaultCredentials()
  }
}

/**
 * Save credentials to disk.
 */
export function saveCredentials(creds: CredentialsFile): void {
  writeCredentials(creds)
}

/**
 * Get the config for the currently active provider.
 * Returns null if no provider is active or configured.
 */
export function getActiveProviderConfig(): ProviderConfig | null {
  const creds = loadCredentials()
  if (!creds.activeProvider || !creds.providers[creds.activeProvider]) {
    return null
  }
  return creds.providers[creds.activeProvider]
}

/**
 * Get the active API key from the credential pool.
 * Returns null if none available.
 */
export function getActiveApiKey(): string | null {
  const config = getActiveProviderConfig()
  if (!config) return null
  const entry = config.keys[config.activeKeyIndex]
  if (!entry || entry.exhausted) return null
  return entry.value
}

/**
 * Get the base URL for the currently active provider.
 * Returns null if no provider is configured.
 */
export function getActiveBaseUrl(): string | null {
  const config = getActiveProviderConfig()
  return config?.baseUrl ?? null
}

/**
 * Get the active model name from the credential pool.
 * Returns null if none configured.
 */
export function getActiveModel(): string | null {
  const config = getActiveProviderConfig()
  return config?.activeModel ?? null
}

/**
 * Switch to a different provider by name.
 * If the provider doesn't exist, does nothing and returns false.
 */
export function switchProvider(name: string): boolean {
  const creds = loadCredentials()
  if (!creds.providers[name]) return false
  creds.activeProvider = name
  saveCredentials(creds)
  return true
}

/**
 * List all configured provider names.
 */
export function listProviders(): string[] {
  return Object.keys(loadCredentials().providers)
}

/**
 * Add a new provider configuration.
 */
export function addProvider(
  name: string,
  config: ProviderConfig,
): void {
  const creds = loadCredentials()
  creds.providers[name] = config
  if (!creds.activeProvider) {
    creds.activeProvider = name
  }
  saveCredentials(creds)
}

/**
 * Remove a provider and all its keys.
 * If it was the active provider, resets active to first available.
 */
export function removeProvider(name: string): boolean {
  const creds = loadCredentials()
  if (!creds.providers[name]) return false
  delete creds.providers[name]
  if (creds.activeProvider === name) {
    const remaining = Object.keys(creds.providers)
    creds.activeProvider = remaining.length > 0 ? remaining[0] : ''
  }
  saveCredentials(creds)
  return true
}

/**
 * Find which provider's model list contains the given model.
 * Active provider is checked first (ties resolve to it), then config order.
 * Returns null if no provider lists the model.
 */
export function findModelProvider(model: string): string | null {
  const creds = loadCredentials()
  const cur = creds.activeProvider ? creds.providers[creds.activeProvider] : undefined
  if (cur && Array.isArray(cur.models) && cur.models.includes(model)) {
    return creds.activeProvider
  }
  for (const [name, cfg] of Object.entries(creds.providers)) {
    if (Array.isArray(cfg.models) && cfg.models.includes(model)) return name
  }
  return null
}

/**
 * 2026-08-29 直接切模型自动切供应商：模型属其它供应商 → 全局切 activeProvider
 * 并写该供应商 activeModel（保持池状态一致）；同供应商 → 原样不动（会话级切换不写池）。
 * 返回归属供应商名；模型不在任何供应商清单 → null。
 */
export function ensureProviderForModel(model: string): string | null {
  const owner = findModelProvider(model)
  if (!owner) return null
  const creds = loadCredentials()
  if (creds.activeProvider === owner) return owner
  creds.activeProvider = owner
  const cfg = creds.providers[owner]
  if (cfg && Array.isArray(cfg.models) && cfg.models.includes(model)) {
    cfg.activeModel = model
  }
  saveCredentials(creds)
  return owner
}

/**
 * Switch model globally: resolve the owning provider, switch to it and write
 * its activeModel. Always writes (unlike ensureProviderForModel).
 * Returns false if no provider lists the model.
 */
export function switchModelAuto(model: string): boolean {
  const owner = findModelProvider(model)
  if (!owner) return false
  const creds = loadCredentials()
  creds.activeProvider = owner
  const cfg = creds.providers[owner]
  if (cfg && Array.isArray(cfg.models) && cfg.models.includes(model)) {
    cfg.activeModel = model
  }
  saveCredentials(creds)
  return true
}

/**
 * Switch to a model within the current provider.
 */
export function switchModel(model: string): boolean {
  const creds = loadCredentials()
  const provider = creds.providers[creds.activeProvider]
  if (!provider) return false
  if (!provider.models.includes(model)) return false
  provider.activeModel = model
  saveCredentials(creds)
  return true
}

/**
 * Get the explicit vision override for a model in the current provider.
 * Returns undefined when no override is set (name-pattern detection applies).
 */
export function getModelVision(model: string): boolean | undefined {
  const config = getActiveProviderConfig()
  return config?.modelVision?.[model]
}

/**
 * Set or clear the explicit vision override for a model in the current provider.
 * Pass undefined to clear the override (fall back to name-pattern detection).
 */
export function setModelVision(
  model: string,
  vision: boolean | undefined,
): void {
  const creds = loadCredentials()
  const provider = creds.providers[creds.activeProvider]
  if (!provider) return
  const modelVision = provider.modelVision ?? {}
  if (vision === undefined) {
    delete modelVision[model]
  } else {
    modelVision[model] = vision
  }
  provider.modelVision = modelVision
  saveCredentials(creds)
}

/**
 * Rotate to the next non-exhausted key in the current provider.
 * Returns the new active key, or null if no usable keys remain.
 */
export function rotateKey(): string | null {
  const creds = loadCredentials()
  const provider = creds.providers[creds.activeProvider]
  if (!provider || provider.keys.length === 0) return null

  const startIndex = provider.activeKeyIndex
  let index = (startIndex + 1) % provider.keys.length

  while (index !== startIndex) {
    if (!provider.keys[index].exhausted) {
      provider.activeKeyIndex = index
      saveCredentials(creds)
      return provider.keys[index].value
    }
    index = (index + 1) % provider.keys.length
  }

  // All keys exhausted — try the starting position one last time
  if (!provider.keys[startIndex].exhausted) {
    return provider.keys[startIndex].value
  }
  return null
}

/**
 * Mark the current key as exhausted (e.g., after a 401).
 */
export function markCurrentKeyExhausted(): void {
  const creds = loadCredentials()
  const provider = creds.providers[creds.activeProvider]
  if (!provider) return
  const entry = provider.keys[provider.activeKeyIndex]
  if (!entry) return
  entry.exhausted = true
  entry.exhaustedAt = Date.now()
  saveCredentials(creds)
}

/**
 * Add an API key to the current provider's pool.
 */
export function addKey(key: string): void {
  const creds = loadCredentials()
  const provider = creds.providers[creds.activeProvider]
  if (!provider) return
  provider.keys.push({ value: key, exhausted: false })
  saveCredentials(creds)
}

/**
 * Remove an API key from the current provider's pool by index.
 */
export function removeKey(index: number): boolean {
  const creds = loadCredentials()
  const provider = creds.providers[creds.activeProvider]
  if (!provider || index < 0 || index >= provider.keys.length) return false
  provider.keys.splice(index, 1)
  if (provider.activeKeyIndex >= provider.keys.length) {
    provider.activeKeyIndex = Math.max(0, provider.keys.length - 1)
  }
  saveCredentials(creds)
  return true
}

/**
 * Check if the current provider has non-exhausted keys remaining.
 */
export function hasUsableKeys(): boolean {
  const config = getActiveProviderConfig()
  if (!config) return false
  return config.keys.some(k => !k.exhausted)
}

/** Check if credentials.json exists on disk. */
export function credentialsFileExists(): boolean {
  return existsSync(_getCredentialsPath())
}
