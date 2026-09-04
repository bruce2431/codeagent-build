/**
 * Neuron 注册表 — 双层根扫描发现（目录即注册）
 *
 * TS 内置引擎（2026-09-03 TS 化定案）。对照 Python 基线 engine/core/config.py。
 *
 * 双层根（v2 定案）：
 *   - cwd 根     = <cwd>/.claude/neturon/        （项目级库）
 *   - 全局根     = <configHome>/neturon/          （跨项目通用库）
 *   - RAG_DATA_DIR 环境变量可追加（os.pathsep 分隔，兼容外部用法）
 *
 * 扫描发现（neurons.yaml 注册表废弃）：
 *   - 每个神经元 = 某根 neurons/ 下同时含 config.yaml 与 l2.mem/mem.json 的子目录
 *   - id = config.yaml 的 person.id（跨根全局唯一，冲突抛错不静默）
 *   - name = config.yaml 的 name（可选，缺省目录名去 Neuron-/Neturon- 前缀）
 *   - type = config.yaml 的 type（可选，缺省 knowledge；skill 型由 recall 门槛泛化推荐）
 *   - description = config.yaml prompts.should_search（名册触发文案权威源）
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { getProjectRoot } from '../../bootstrap/state.js'
import { parse as parseYaml } from 'yaml'

export class ConfigError extends Error {}

/** 点号路径读取配置；键缺失抛 ConfigError，消息含缺失键名 + 上下文。 */
export function cfgRequired(cfg: unknown, path: string, context = ''): unknown {
  let node: unknown = cfg
  for (const key of path.split('.')) {
    if (node && typeof node === 'object' && key in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[key]
    } else {
      const where = context ? `（${context}）` : ''
      throw new ConfigError(`缺少配置: ${path}${where}`)
    }
  }
  return node
}

/** 点号路径读取配置；键缺失返回 default（不抛错）。 */
export function cfgGet(cfg: unknown, path: string, defaultValue?: unknown): unknown {
  let node: unknown = cfg
  for (const key of path.split('.')) {
    if (node && typeof node === 'object' && key in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[key]
    } else {
      return defaultValue
    }
  }
  return node
}

export interface NeuronEntry {
  id: string
  name: string
  path: string
  root: string
  type: 'knowledge' | 'skill' | string
  skills: string[]
  description: string
}

export interface NeuronInfo extends NeuronEntry {
  mem_count: number
  cog2_count: number
  last_updated: string
}

/** 全局根：<configHome>/neturon/ */
export function getGlobalRoot(): string {
  return join(getClaudeConfigHomeDir(), 'neturon')
}

/** cwd 根：<cwd>/.claude/neturon/ */
export function getCwdRoot(cwd?: string): string {
  const root = cwd ?? getProjectRoot() ?? process.cwd()
  return join(root, '.claude', 'neturon')
}

/** 引擎挂载的根列表（cwd 根 + 全局根 + RAG_DATA_DIR 追加） */
export function getBuiltinRoots(cwd?: string): string[] {
  const roots = [getCwdRoot(cwd), getGlobalRoot()]
  const env = process.env.RAG_DATA_DIR
  if (env) {
    // os.pathsep 语义：win=';'（盘符含':'不能当分隔），posix=':'
    for (const p of env.split(process.platform === 'win32' ? ';' : ':')) {
      if (p.trim()) roots.push(resolve(p.trim()))
    }
  }
  return [...new Set(roots)]
}

function stripNeuronPrefix(entryName: string): string {
  for (const prefix of ['Neuron-', 'Neturon-']) {
    if (entryName.startsWith(prefix)) return entryName.slice(prefix.length)
  }
  return entryName
}

function readYamlSafe(path: string): Record<string, unknown> | null {
  try {
    if (!existsSync(path)) return null
    return (parseYaml(readFileSync(path, 'utf-8')) as Record<string, unknown>) ?? {}
  } catch {
    return null
  }
}

/** 扫描给定根列表的 neurons/ 子目录，目录即注册。id 冲突抛 ConfigError。 */
function scanRoots(roots: string[]): Map<string, NeuronEntry> {
  const reg = new Map<string, NeuronEntry>()
  for (const root of roots) {
    const neuronsDir = join(root, 'neurons')
    if (!existsSync(neuronsDir) || !statSync(neuronsDir).isDirectory()) continue
    let entryNames: string[] = []
    try {
      entryNames = readdirSync(neuronsDir).sort()
    } catch {
      continue
    }
    for (const entryName of entryNames) {
      const path = join(neuronsDir, entryName)
      try {
        if (!statSync(path).isDirectory()) continue
      } catch {
        continue
      }
      const cfgPath = join(path, 'config.yaml')
      const memPath = join(path, 'l2.mem', 'mem.json')
      if (!existsSync(cfgPath) || !existsSync(memPath)) continue // 缺一不算
      const cfg = readYamlSafe(cfgPath)
      if (!cfg) continue
      const person = (cfg.person as Record<string, unknown> | undefined) ?? {}
      const nid = String(person.id ?? '').trim()
      if (!nid) continue // person.id 必填，缺则跳过
      if (reg.has(nid)) {
        throw new ConfigError(
          `Neuron id 冲突: '${nid}' 同时发现于 ${reg.get(nid)!.path} 与 ${path}（person.id 须跨根唯一，起独特小代号）`,
        )
      }
      const prompts = (cfg.prompts as Record<string, unknown> | undefined) ?? {}
      reg.set(nid, {
        id: nid,
        name: String(cfg.name ?? stripNeuronPrefix(entryName)),
        path,
        root,
        type: (cfg.type as string) ?? 'knowledge',
        skills: Array.isArray(cfg.skills) ? (cfg.skills as string[]) : [],
        description: String(prompts.should_search ?? '').trim(),
      })
    }
  }
  return reg
}

function getNeuronStats(neuronPath: string): { mem_count: number; cog2_count: number; last_updated: string } {
  const stats = { mem_count: 0, cog2_count: 0, last_updated: '' }
  try {
    const memPath = join(neuronPath, 'l2.mem', 'mem.json')
    if (existsSync(memPath)) {
      const entries = JSON.parse(readFileSync(memPath, 'utf-8'))
      stats.mem_count = Array.isArray(entries) ? entries.length : 0
      stats.last_updated = new Date(statSync(memPath).mtime).toISOString().slice(0, 19)
    }
  } catch {
    // 统计失败不阻断
  }
  try {
    const cog2Path = join(neuronPath, 'l1.cog', 'cog2.json')
    if (existsSync(cog2Path)) {
      const cog2 = JSON.parse(readFileSync(cog2Path, 'utf-8'))
      stats.cog2_count = Array.isArray(cog2?.cog2_records) ? cog2.cog2_records.length : 0
    }
  } catch {
    // 统计失败不阻断
  }
  return stats
}

// ── 注册表缓存（10s TTL：长驻进程内新建库下下次查询自然可见） ──

let _registry: Map<string, NeuronEntry> | null = null
let _registryAt = 0
const REGISTRY_TTL_MS = 10_000

function scanRegistry(cwd?: string): Map<string, NeuronEntry> {
  const now = Date.now()
  if (_registry && now - _registryAt < REGISTRY_TTL_MS) return _registry
  _registry = scanRoots(getBuiltinRoots(cwd))
  _registryAt = now
  return _registry
}

/** 主动扫描任意目录根（一次性，不动缓存） */
export function listNeuronsInRoot(root: string): NeuronInfo[] {
  const abs = isAbsolute(root) ? root : resolve(getProjectRoot() ?? process.cwd(), root)
  const infos: NeuronInfo[] = []
  for (const entry of scanRoots([abs]).values()) {
    const stats = getNeuronStats(entry.path)
    infos.push({ ...entry, ...stats })
  }
  return infos.sort((a, b) => a.id.localeCompare(b.id))
}

/** 双根全查：所有发现 Neuron 的元数据 + 实时统计 */
export function listNeurons(cwd?: string): NeuronInfo[] {
  const infos: NeuronInfo[] = []
  for (const entry of scanRegistry(cwd).values()) {
    const stats = getNeuronStats(entry.path)
    infos.push({ ...entry, ...stats })
  }
  return infos.sort((a, b) => a.id.localeCompare(b.id))
}

/** neuron_id → 绝对路径（查扫描缓存） */
export function resolveNeuronPath(neuronId: string, cwd?: string): string {
  const entry = scanRegistry(cwd).get(neuronId)
  if (!entry) {
    throw new ConfigError(`Neuron '${neuronId}' 未发现。可用: ${[...scanRegistry(cwd).keys()].join(', ')}`)
  }
  if (!existsSync(entry.path)) {
    throw new ConfigError(`Neuron 路径不存在: ${entry.path}`)
  }
  return entry.path
}

/** neuron_id → 扫描条目 */
export function getNeuronInfo(neuronId: string, cwd?: string): NeuronEntry {
  const entry = scanRegistry(cwd).get(neuronId)
  if (!entry) throw new ConfigError(`Neuron '${neuronId}' 未发现`)
  return entry
}

/** neuron 目录名（读 config.yaml 的目录侧信息用） */
export function neuronDirName(path: string): string {
  return basename(path)
}
