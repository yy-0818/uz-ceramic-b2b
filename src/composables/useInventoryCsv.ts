/**
 * useInventoryCsv —— 解析工厂每日 CSV（库存表）
 *
 * CSV 列结构（已实测 1767 行 × 68 列）：
 *   列 0:   (空)         = 客户组（如 "A中鹏"、"S客户Rich"），共 34 个
 *   列 1:   型号         = 产品编号（如 A12E900）
 *   列 2:   类型         = 瓷砖分类（12J / 12P / 12F ...）
 *   列 3:   1级          = 1 级仓总库存
 *   列 4:   2级          = 2 级仓总库存
 *   列 5-26:D1 - D22     = 1 级仓各色号分布（每个非零 = 一个色号 + 箱数）
 *   列 27-41:A + A1-A14  = 1 级仓另 15 个色号
 *   列 42:  辅助列       = 显示 / 不显示
 *   列 44:  换算率       = 每箱多少平方米
 *   列 46:  备注         = "同花色1"、"同色号1" 等色号分组标记
 *
 * 输出：每个 model = 一个 ProductCandidate，colors = 该型号下的所有色号
 */
import { ref, computed } from 'vue'
import Papa from 'papaparse'

/** 单个色号行 */
export interface ColorStock {
  colorCode: string         // 'D1' 'D12' 'A' 'A3'
  stockLevel: 1 | 2         // 1 级或 2 级（CSV 当前只在 1 级填色号分布）
  boxes: number             // 箱数
}

/** 候选产品（一个型号聚合所有色号 + 所有出现过的客户组） */
export interface ProductCandidate {
  model: string
  category: string
  conversionRate: number
  remark: string
  totalLevel1: number
  totalLevel2: number
  colors: ColorStock[]
  /** 该型号在哪些客户组出现 —— 用于后续做"客户组→账户"映射 */
  customerGroups: string[]
  isVisible: boolean        // 辅助列 = "显示" / "不显示"
  existsInDb: boolean
}

/** 原始 CSV 行（按位置访问，不依赖列名） */
interface RawRow {
  rowIndex: number
  customerGroup: string
  model: string
  category: string
  level1: number
  level2: number
  /** 长度为 22 的 D1-D22，索引 0=D1 */
  dCols: number[]
  /** 长度为 15 的 A, A1-A14，索引 0=A */
  aCols: number[]
  conversionRate: number
  remark: string
  isVisible: boolean
}

/** 安全地把字符串转 number，空值返回 0 */
function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0
  const s = String(v).trim()
  if (s === '' || s === '-' || s === '0') return 0
  const n = Number(s.replace(/[,,]/g, '.'))
  return Number.isFinite(n) ? n : 0
}

/** 根据表头位置拿列索引 */
function detectColumnIndexes(header: string[]): {
  modelIdx: number
  categoryIdx: number
  level1Idx: number
  level2Idx: number
  conversionIdx: number
  remarkIdx: number
  dStartIdx: number       // D1 列位置
  aStartIdx: number       // A 列位置
  visibleIdx: number      // 辅助列
  groupIdx: number        // 客户组（第 1 列）
} {
  const find = (pred: (s: string) => boolean, fallback = -1) =>
    header.findIndex(pred)

  return {
    groupIdx: 0,                                    // CSV 第 1 列恒为客户组
    modelIdx: find((s) => s.trim() === '型号', 1),
    categoryIdx: find((s) => s.trim() === '类型', 2),
    level1Idx: find((s) => s.trim() === '1级', 3),
    level2Idx: find((s) => s.trim() === '2级', 4),
    dStartIdx: find((s) => s.trim() === 'D1', 5),
    aStartIdx: find((s) => s.trim() === 'A', 27),
    conversionIdx: find((s) => s.trim() === '换算率', 44),
    remarkIdx: find((s) => s.trim() === '备注', 46),
    visibleIdx: find((s) => s.trim() === '辅助列', 42),
  }
}

/**
 * 解析一行：把 D1-D22 / A-A14 转成色号记录
 * 约定：色号非零才保留（0 = 该型号没这个色号的库存）
 */
function parseRowByIndex(
  row: Record<string, string>,
  idx: ReturnType<typeof detectColumnIndexes>,
  rowIndex: number,
): RawRow | null {
  const keys = Object.keys(row)
  const val = (i: number) => (i >= 0 && i < keys.length ? (row[keys[i]] || '').trim() : '')

  const customerGroup = val(idx.groupIdx)
  const model = val(idx.modelIdx)
  const category = val(idx.categoryIdx)
  // 跳过合计行：model 为 "合计" 或 category 为空
  if (!customerGroup || !model || !category) return null
  if (model === '合计' || category === '合计') return null
  // 防御：跳过类型列含中文合计关键字的行
  if (/合计|总计|小计/.test(model) || /合计|总计|小计/.test(category)) return null

  const level1 = toNum(val(idx.level1Idx))
  const level2 = toNum(val(idx.level2Idx))
  const conversionRate = toNum(val(idx.conversionIdx)) || 1
  const remark = val(idx.remarkIdx)
  const isVisible = val(idx.visibleIdx) === '显示'

  // D1-D22 共 22 列
  const dCols: number[] = []
  for (let i = 0; i < 22; i++) dCols.push(toNum(val(idx.dStartIdx + i)))

  // A + A1-A14 共 15 列
  const aCols: number[] = []
  for (let i = 0; i < 15; i++) aCols.push(toNum(val(idx.aStartIdx + i)))

  return {
    rowIndex,
    customerGroup,
    model,
    category,
    level1,
    level2,
    dCols,
    aCols,
    conversionRate,
    remark,
    isVisible,
  }
}

/** 把 raw 聚合为 candidate */
function buildCandidates(rawRows: RawRow[]): {
  products: ProductCandidate[]
  customerGroups: string[]
} {
  const map = new Map<string, ProductCandidate>()
  const groupSet = new Set<string>()

  for (const r of rawRows) {
    groupSet.add(r.customerGroup)

    let c = map.get(r.model)
    if (!c) {
      c = {
        model: r.model,
        category: r.category,
        conversionRate: r.conversionRate,
        remark: r.remark,
        totalLevel1: 0,
        totalLevel2: 0,
        colors: [],
        customerGroups: [],
        isVisible: r.isVisible,
        existsInDb: false,
      }
      map.set(r.model, c)
    }

    // 客户组去重
    if (!c.customerGroups.includes(r.customerGroup)) {
      c.customerGroups.push(r.customerGroup)
    }

    // 累计总库存（不同客户组对同一型号的累加）
    c.totalLevel1 += r.level1
    c.totalLevel2 += r.level2

    // 同型号的色号重复时合并（多个客户组填同一色号）
    for (let i = 0; i < 22; i++) {
      const boxes = r.dCols[i]
      if (boxes > 0) mergeColor(c, `D${i + 1}`, 1, boxes)
    }
    // A 列特殊：索引 0 = 'A'，1..14 = 'A1'..'A14'
    for (let i = 0; i < 15; i++) {
      const boxes = r.aCols[i]
      if (boxes > 0) {
        const code = i === 0 ? 'A' : `A${i}`
        mergeColor(c, code, 1, boxes)
      }
    }
  }

  return {
    products: Array.from(map.values()),
    customerGroups: Array.from(groupSet).sort(),
  }
}

function mergeColor(c: ProductCandidate, code: string, level: 1 | 2, boxes: number) {
  const exist = c.colors.find((x) => x.colorCode === code && x.stockLevel === level)
  if (exist) exist.boxes += boxes
  else c.colors.push({ colorCode: code, stockLevel: level, boxes })
}

export function useInventoryCsv() {
  const filename = ref<string>('')
  const rawRows = ref<RawRow[]>([])
  const products = ref<ProductCandidate[]>([])
  const customerGroups = ref<string[]>([])
  const parsing = ref(false)
  const error = ref<string | null>(null)

  const parseFile = async (
    file: File,
    existingModels: Set<string> = new Set(),
  ): Promise<void> => {
    parsing.value = true
    error.value = null
    filename.value = file.name
    rawRows.value = []
    products.value = []

    return new Promise<void>((resolve, reject) => {
      Papa.parse<Record<string, string>>(file, {
        header: true,
        skipEmptyLines: 'greedy',
        worker: false,
        complete: (res) => {
          try {
            if (!res.meta.fields || res.meta.fields.length === 0) {
              throw new Error('CSV 表头为空或解析失败')
            }
            const idx = detectColumnIndexes(res.meta.fields)
            const rows: RawRow[] = []
            res.data.forEach((r, i) => {
              const parsed = parseRowByIndex(r, idx, i)
              if (parsed) rows.push(parsed)
            })
            rawRows.value = rows
            const built = buildCandidates(rows)
            products.value = built.products.map((p) => ({
              ...p,
              existsInDb: existingModels.has(p.model),
            }))
            customerGroups.value = built.customerGroups
            resolve()
          } catch (e) {
            error.value = e instanceof Error ? e.message : 'CSV 解析失败'
            reject(e)
          } finally {
            parsing.value = false
          }
        },
        error: (err) => {
          error.value = err.message
          parsing.value = false
          reject(err)
        },
      })
    })
  }

  const markExists = (models: string[]) => {
    const set = new Set(models)
    products.value = products.value.map((p) =>
      set.has(p.model) ? { ...p, existsInDb: true } : p,
    )
  }

  const totalRows = computed(() => rawRows.value.length)
  const totalProducts = computed(() => products.value.length)
  const totalColors = computed(() =>
    products.value.reduce((s, p) => s + p.colors.length, 0),
  )
  const totalGroups = computed(() => customerGroups.value.length)

  return {
    filename,
    rawRows,
    products,
    customerGroups,
    parsing,
    error,
    totalRows,
    totalProducts,
    totalColors,
    totalGroups,
    parseFile,
    markExists,
  }
}