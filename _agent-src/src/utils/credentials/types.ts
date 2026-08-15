/**
 * Credential pool types for multi-provider, multi-key, multi-model support.
 *
 * Each provider config (Anthropic, DeepSeek, Kimi, GLM, etc.) stores its own:
 * - base URL (Anthropic-compatible endpoint)
 * - Pool of API keys with exhaustion tracking
 * - List of available models
 * - Active selections (which key, which model)
 *
 * All providers in this pool share the Anthropic SDK client path
 * (new Anthropic({apiKey, baseURL, ...})). Bedrock/Vertex/Foundry
 * use separate SDKs and are excluded from this pool.
 */

export interface ApiKeyEntry {
  /** The actual API key string */
  value: string
  /** Whether this key is marked as exhausted (e.g., rate-limited) */
  exhausted: boolean
  /** Timestamp when exhausted, for auto-recovery */
  exhaustedAt?: number
}

export interface ProviderConfig {
  /** Anthropic-compatible base URL (e.g., https://api.deepseek.com/anthropic) */
  baseUrl: string
  /** Pool of API keys for this provider */
  keys: ApiKeyEntry[]
  /** Index into keys[] of the currently active key */
  activeKeyIndex: number
  /** Available model names for this provider */
  models: string[]
  /** Currently selected model name */
  activeModel: string
  /**
   * Per-model explicit vision capability override.
   * `undefined` for a model = not set → fall back to name-pattern detection.
   * Absent entirely (old credentials.json) = same as empty.
   */
  modelVision?: Record<string, boolean>
}

export interface CredentialsFile {
  /** Name of the currently active provider */
  activeProvider: string
  /** All configured providers, keyed by name */
  providers: Record<string, ProviderConfig>
}
