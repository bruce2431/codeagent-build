/**
 * precog 拟合环 — fill_precog（p4）+ list_unfilled
 *
 * 对照 Python 基线 engine/core/cognition.py 同名函数 1:1 移植。
 * p5-p7 聚合管线按 2026-09-03 定案移除（神经元仅作为数据库），
 * 认知层文件（cog_graph.json 等）保留为静态数据资产供检索反查。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveNeuronPath } from './config.js'
import { serializeCog } from './serialize.js'
import type { PrecogRecord } from './retriever.js'

interface CogFile {
  precog_records?: PrecogRecord[]
  cog_records?: unknown[]
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return null
  }
}

function writeCogJson(path: string, data: CogFile): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, serializeCog(data) + '\n', 'utf-8')
  renameSync(tmp, path)
}

/** 填写一条 precog 记录的 description 和 accuracy（拟合环标注） */
export function fillPrecog(
  neuronId: string,
  recordId: string,
  description: string,
  accuracyList: string[],
  cwd?: string,
): { status: 'ok' | 'error'; message: string } {
  let neuronPath: string
  try {
    neuronPath = resolveNeuronPath(neuronId, cwd)
  } catch (e) {
    return { status: 'error', message: (e as Error).message }
  }
  const cogPath = join(neuronPath, 'l1.cog', 'cog.json')
  const data = readJson<CogFile>(cogPath)
  if (!data) return { status: 'error', message: 'cog.json 不存在' }

  const target = (data.precog_records ?? []).find(r => r.record_id === recordId)
  if (!target) return { status: 'error', message: `找不到记录 ${recordId}` }

  const nResults = target.results?.length ?? 0

  const errors: string[] = []
  if (description.length < 60) errors.push(`description 仅 ${description.length} 字，需 ≥ 60`)
  if (accuracyList.length !== nResults) {
    errors.push(`accuracy 条目数 ${accuracyList.length} ≠ 结果数 ${nResults}`)
  }
  const valid = new Set(['true', 'revelant', 'false', ''])
  const invalid = accuracyList.filter(a => !valid.has(a))
  if (invalid.length) errors.push(`无效 accuracy 值: ${invalid.join(',')}`)

  if (errors.length) return { status: 'error', message: errors.join('; ') }

  target.description = description
  accuracyList.forEach((acc, i) => {
    if (target.results && i < target.results.length) target.results[i]!.accuracy = acc
  })

  // 重排序：false 置底
  target.results?.sort((a, b) => {
    const fa = a.accuracy === 'false' ? 1 : 0
    const fb = b.accuracy === 'false' ? 1 : 0
    return fa - fb || (a.id ?? '').localeCompare(b.id ?? '')
  })

  writeCogJson(cogPath, data)
  return { status: 'ok', message: `${recordId} 已填写` }
}

/** 列出所有 description 为空的 precog 记录 */
export function listUnfilled(
  neuronId: string,
  cwd?: string,
): Array<{ record_id: string; query: string; results_count: number; accuracy_filled: number }> {
  let neuronPath: string
  try {
    neuronPath = resolveNeuronPath(neuronId, cwd)
  } catch {
    return []
  }
  const data = readJson<CogFile>(join(neuronPath, 'l1.cog', 'cog.json'))
  if (!data) return []
  const unfilled: Array<{ record_id: string; query: string; results_count: number; accuracy_filled: number }> = []
  for (const r of data.precog_records ?? []) {
    if ((r.description ?? '').trim()) continue
    const results = r.results ?? []
    unfilled.push({
      record_id: r.record_id ?? '',
      query: r.query ?? '',
      results_count: results.length,
      accuracy_filled: results.filter(x => x.accuracy ?? '').length,
    })
  }
  return unfilled
}
