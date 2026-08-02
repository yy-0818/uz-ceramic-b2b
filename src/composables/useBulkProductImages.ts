/**
 * useBulkProductImages —— 批量上传商品图（zip 包）
 *
 * 设计选择:
 *   - 不用 edge function. Deno 那边跑 JSZip + 走 storage API 反而复杂.
 *   - 复用现有 uploadProductImage(). 同一 RLS / 同一路径 / 同一 storage 桶.
 *   - JSZip 在浏览器里解压 < 1s, 然后逐张并发上传 (3 并发).
 *   - 单张失败不影响其他. 错误聚合在最后返回.
 *
 * zip 包约束:
 *   - 文件名 (去扩展名) = product.model, 例如 A12P001.png
 *     model 匹配 products.model 查 product_id, 再走单图上传.
 *   - 支持 png / jpg / jpeg / webp / gif.
 *   - 跳过非图片 + __MACOSX 等 macOS 资源文件.
 *   - 不支持嵌套子目录 (扁平化路径).
 *
 * 进度粒度: 4 个阶段
 *   1. parsing  (解压)
 *   2. matching (model -> product_id 映射)
 *   3. uploading (并发上传)
 *   4. done
 */
import JSZip from 'jszip'
import { uploadProductImage } from './useProductImage'

const ALLOWED_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif'])
const CONCURRENCY = 3
const MAX_FILES = 200
const MAX_TOTAL_BYTES = 200 * 1024 * 1024  // 200 MB

export type BulkPhase = 'idle' | 'parsing' | 'matching' | 'uploading' | 'done'

export interface BulkFileResult {
  filename: string
  model: string | null
  productId: string | null
  status: 'ok' | 'skipped' | 'unmatched' | 'error'
  message?: string
}

export interface BulkResult {
  total: number
  ok: number
  unmatched: number
  error: number
  skipped: number
  files: BulkFileResult[]
}

export interface BulkProgress {
  phase: BulkPhase
  total: number
  done: number
  /** 当前并发槽里的文件名 */
  inFlight: string[]
  /** 最近一次报错 (整批) */
  error: string | null
}

/**
 * 跑批量上传
 *
 * @param zipFile   admin 选的 .zip
 * @param modelToProductId  商品 model -> product_id 映射表
 *                          调用方从 useProducts.fetchAllWithColors() 拼出来
 * @param onProgress  阶段 / 进度回调 (用于 UI 进度条)
 */
export async function bulkUploadProductImages(
  zipFile: File,
  modelToProductId: Map<string, string>,
  onProgress?: (p: BulkProgress) => void,
): Promise<BulkResult> {
  const emit = (p: Partial<BulkProgress>) =>
    onProgress?.({
      phase: 'idle',
      total: 0,
      done: 0,
      inFlight: [],
      error: null,
      ...p,
    } as BulkProgress)

  if (zipFile.size > MAX_TOTAL_BYTES) {
    throw new Error(`zip 包过大: ${(zipFile.size / 1024 / 1024).toFixed(1)} MB（上限 200 MB）`)
  }

  // Phase 1: 解压
  emit({ phase: 'parsing' })
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(zipFile)
  } catch (e: any) {
    throw new Error(`解压失败: ${e?.message ?? String(e)}`)
  }

  // 过滤出图片文件
  const entries = Object.values(zip.files).filter((e) => {
    if (e.dir) return false
    // 跳过 macOS 资源目录
    if (e.name.includes('__MACOSX/')) return false
    const ext = e.name.split('.').pop()?.toLowerCase() ?? ''
    return ALLOWED_EXT.has(ext)
  })

  if (entries.length === 0) {
    throw new Error('zip 包里没有图片文件（png/jpg/jpeg/webp/gif）')
  }
  if (entries.length > MAX_FILES) {
    throw new Error(`文件数过多: ${entries.length}（上限 ${MAX_FILES} 张）`)
  }

  // Phase 2: model 匹配
  emit({ phase: 'matching', total: entries.length })
  const tasks: Array<{
    filename: string
    model: string
    productId: string | null
    entry: JSZip.JSZipObject
  }> = []
  for (const entry of entries) {
    const filename = entry.name.split('/').pop() ?? entry.name
    // 去扩展名
    const model = filename.replace(/\.[^.]+$/, '').trim()
    const productId = modelToProductId.get(model) ?? null
    tasks.push({ filename, model, productId, entry })
  }

  const unmatchedTasks = tasks.filter((t) => !t.productId)
  const matchedTasks = tasks.filter((t) => t.productId)

  // Phase 3: 并发上传 (matched tasks)
  emit({
    phase: 'uploading',
    total: matchedTasks.length,
    done: 0,
    inFlight: [],
  })

  const results: BulkFileResult[] = []
  let done = 0

  // 给 unmatched 也填结果
  for (const t of unmatchedTasks) {
    results.push({
      filename: t.filename,
      model: t.model,
      productId: null,
      status: 'unmatched',
      message: `未在 products 表里找到 model = "${t.model}" 的商品`,
    })
  }

  // 简单的并发池
  let cursor = 0
  const inFlight = new Set<string>()
  const updateEmit = () =>
    emit({
      phase: 'uploading',
      total: matchedTasks.length,
      done,
      inFlight: Array.from(inFlight),
    })

  const worker = async () => {
    while (cursor < matchedTasks.length) {
      const idx = cursor++
      const t = matchedTasks[idx]
      inFlight.add(t.filename)
      updateEmit()
      try {
        const blob = await t.entry.async('blob')
        const file = new File([blob], t.filename, {
          type: blob.type || `image/${t.filename.split('.').pop()}`,
        })
        const url = await uploadProductImage(t.productId!, file)
        results.push({
          filename: t.filename,
          model: t.model,
          productId: t.productId,
          status: 'ok',
          message: url,
        })
      } catch (e: any) {
        results.push({
          filename: t.filename,
          model: t.model,
          productId: t.productId,
          status: 'error',
          message: e?.message ?? String(e),
        })
      } finally {
        inFlight.delete(t.filename)
        done++
        updateEmit()
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, matchedTasks.length) }, () => worker()),
  )

  // Phase 4: done
  emit({ phase: 'done', total: matchedTasks.length, done: matchedTasks.length, inFlight: [] })

  // 排序: ok 在前, 然后 unmatched, 然后 error
  const order: Record<BulkFileResult['status'], number> = {
    ok: 0,
    unmatched: 1,
    error: 2,
    skipped: 3,
  }
  results.sort((a, b) => order[a.status] - order[b.status] || a.filename.localeCompare(b.filename))

  return {
    total: entries.length,
    ok: results.filter((r) => r.status === 'ok').length,
    unmatched: results.filter((r) => r.status === 'unmatched').length,
    error: results.filter((r) => r.status === 'error').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    files: results,
  }
}
