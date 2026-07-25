/**
 * useInventoryCsv —— 解析工厂每日 CSV（库存表）
 *
 * 关键业务点：
 * - 第一列 = "客户组"（如 "B客户"、"S客户"、"A中鹏"），共 30+ 个组
 * - 客户组 ≠ account_id，需要后台手动勾选映射
 * - 必备列：型号、类型、1级、2级、换算率、备注、客户组
 * - 解析后输出：按 model 聚合的"候选商品 + 该商品在哪些组出现"
 * - 注：CSV 列名带空格（如 " 1级"），已做 trim
 */
import { ref, computed } from 'vue'
import Papa from 'papaparse'

export interface RawCsvRow {
  customerGroup: string  // 客户组（第一列）
  model: string          // 型号
  category: string       // 类型（12P / 12F ...）
  level1: number         // 1 级库存
  level2: number         // 2 级库存
  conversionRate: number // 换算率
  remark: string         // 备注
}

export interface CandidateProduct {
  model: string
  category: string
  conversionRate: number
  remark: string
  /** 该商品在哪些客户组出现，每组对应什么库存 */
  groups: Array<{
    customerGroup: string
    stock_level_1: number
    stock_level_2: number
  }>
  /** 该商品是否已存在于 products 表（导入过） */
  existsInDb: boolean
}

/** 安全地把字符串转 number，空值返回 0 */
function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0
  const s = String(v).trim()
  if (s === '' || s === '-') return 0
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

export function useInventoryCsv() {
  const filename = ref<string>('')
  const rawRows = ref<RawCsvRow[]>([])
  const candidates = ref<CandidateProduct[]>([])
  const customerGroups = ref<string[]>([])
  const parsing = ref(false)
  const error = ref<string | null>(null)

  /** 解析一行（容错：列名带空格 / 部分单元格缺失） */
  const parseRow = (row: Record<string, string>): RawCsvRow | null => {
    // 工厂 CSV 第一列是 customerGroup，但表头经常被合并到一行
    // 改用位置取值：第 1 列 = 客户组, 第 2 列 = 型号, 第 3 列 = 类型
    const keys = Object.keys(row)
    if (keys.length < 3) return null

    const customerGroup = (row[keys[0]] || '').trim()
    const model = (row[keys[1]] || '').trim()
    const category = (row[keys[2]] || '').trim()
    if (!model || !customerGroup) return null

    // 1级 / 2级 通过列名模糊匹配（不同日期导出的列名可能略变）
    let level1 = 0, level2 = 0
    for (const k of keys) {
      const kn = k.trim()
      if (/^1级$|1级\s|1\s?уров/.test(kn)) level1 = toNum(row[k])
      if (/^2级$|2级\s|2\s?уров/.test(kn)) level2 = toNum(row[k])
    }

    const conversionRate = toNum(row['换算率'] ?? row['换算率 ']) || 1
    const remark = (row['备注'] ?? row['备注 '] ?? '').trim()

    return { customerGroup, model, category, level1, level2, conversionRate, remark }
  }

  /** 把 rawRows 聚合成 candidates（按 model 合并多客户组） */
  const buildCandidates = () => {
    const map = new Map<string, CandidateProduct>()
    const groupSet = new Set<string>()

    for (const r of rawRows.value) {
      groupSet.add(r.customerGroup)
      if (!map.has(r.model)) {
        map.set(r.model, {
          model: r.model,
          category: r.category,
          conversionRate: r.conversionRate,
          remark: r.remark,
          groups: [],
          existsInDb: false,
        })
      }
      const c = map.get(r.model)!
      c.groups.push({
        customerGroup: r.customerGroup,
        stock_level_1: r.level1,
        stock_level_2: r.level2,
      })
    }
    candidates.value = Array.from(map.values())
    customerGroups.value = Array.from(groupSet).sort()
  }

  /** 从 File 对象解析 */
  const parseFile = async (file: File, existingModels: Set<string> = new Set()) => {
    parsing.value = true
    error.value = null
    filename.value = file.name
    rawRows.value = []
    candidates.value = []

    return new Promise<void>((resolve, reject) => {
      Papa.parse<Record<string, string>>(file, {
        header: true,
        skipEmptyLines: 'greedy',
        worker: false,
        complete: (res) => {
          try {
            const rows: RawCsvRow[] = []
            for (const r of res.data) {
              const parsed = parseRow(r)
              if (parsed) rows.push(parsed)
            }
            rawRows.value = rows
            buildCandidates()
            // 标记已存在的商品
            candidates.value = candidates.value.map((c) => ({
              ...c,
              existsInDb: existingModels.has(c.model),
            }))
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

  /** 标记某 candidate 已写入 DB（用于导入后批量更新 existsInDb） */
  const markExists = (models: string[]) => {
    const set = new Set(models)
    candidates.value = candidates.value.map((c) =>
      set.has(c.model) ? { ...c, existsInDb: true } : c,
    )
  }

  const totalRows = computed(() => rawRows.value.length)
  const totalCandidates = computed(() => candidates.value.length)
  const totalGroups = computed(() => customerGroups.value.length)

  return {
    filename, rawRows, candidates, customerGroups,
    parsing, error,
    totalRows, totalCandidates, totalGroups,
    parseFile, markExists,
  }
}
