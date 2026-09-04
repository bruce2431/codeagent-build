/**
 * BGE 嵌入器 — transformers.js（ONNX）单例，对照 Python 基线 engine/core/embedder.py
 *
 * Spike 结论（20260903204723-BGE-TS化Spike/SPIKE结论.md）：
 *   - Xenova/bge-small-zh-v1.5 fp32 + CLS 池化 + 归一化 == sentence-transformers 生产路径
 *   - 关键：编码前必须预小写（BertTokenizer do_lower_case 等价归一化），
 *     否则中英混排文本向量偏差（cos 0.90~0.95）——tokenizer.json 无 lowercase 归一化
 *   - 模型缓存落 <全局根>/cache/（首跑自动下载 ~91MB，走 hf-mirror）
 */

import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

// 动态引入，仅本模块持有；feature 门控在工具层，这里无副作用
type Extractor = Awaited<ReturnType<typeof createExtractor>>

interface TransformerJsEnv {
  remoteHost: string
  allowLocalModels: boolean
  cacheDir: string
}

let _extractor: Extractor | null = null
let _extractorPromise: Promise<Extractor> | null = null

/** BertTokenizer do_lower_case=true 的基础归一化：NFD → 去变音符 → 小写 */
export function normalizeForBert(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

async function createExtractor(cacheDir: string): Promise<Extractor> {
  const { pipeline, env } = await import('@huggingface/transformers')
  const tjsEnv = env as unknown as TransformerJsEnv
  // 中国网络：与 Python 侧 HF_ENDPOINT 一致
  tjsEnv.remoteHost = process.env.HF_ENDPOINT || 'https://hf-mirror.com'
  tjsEnv.allowLocalModels = false
  mkdirSync(cacheDir, { recursive: true })
  tjsEnv.cacheDir = cacheDir
  return (await pipeline('feature-extraction', 'Xenova/bge-small-zh-v1.5', {
    dtype: 'fp32',
  })) as Extractor
}

/**
 * BGE 单例懒加载。modelCacheDir = 模型缓存目录（全局根 cache/ 下）。
 * 加载失败抛错由调用方兜底（关键词检索降级）。
 */
export async function getExtractor(modelCacheDir: string): Promise<Extractor> {
  if (_extractor) return _extractor
  if (!_extractorPromise) {
    _extractorPromise = createExtractor(modelCacheDir).then(ex => {
      _extractor = ex
      return ex
    })
  }
  return _extractorPromise
}

/** 批量编码：预小写 → BGE CLS 池化 → L2 归一化。返回 [N][512] 数组。 */
export async function encode(
  texts: string[],
  modelCacheDir: string,
): Promise<number[][]> {
  const extractor = await getExtractor(modelCacheDir)
  const out = await extractor(texts.map(normalizeForBert), {
    pooling: 'cls',
    normalize: true,
  })
  const [n, dim] = out.dims as [number, number]
  const data = out.data as Float32Array
  const vectors: number[][] = []
  for (let i = 0; i < n; i++) {
    vectors.push(Array.from(data.slice(i * dim, (i + 1) * dim)))
  }
  return vectors
}
