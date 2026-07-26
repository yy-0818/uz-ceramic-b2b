/**
 * useStockGroups —— 库存组（白名单粒度）
 *
 * 库存表.csv 的 A 列"客户组"是白名单的最小单位。
 * Admin 上传 stock_groups.csv 后，本 composable 拉取并暴露给分配 UI。
 *
 * API:
 *   - fetchAll()                         拉所有库存组
 *   - importFromCsv(file)                上传 / 解析 / upsert（预览）
 *   - commitImport(preview)              写入 DB
 *   - applyVisibility(productIds)        过滤 SKU（按当前用户的 stock_group 白名单）
 *
 * 当前用户在 useAuth 中通过 supabase.auth + 当前父账号解析。
 *
 * 备注：库存表里一个型号（如 A12J1050）属于一个客户组（A中鹏）。
 * 产品行的 stock_group 字段由上传库存表时同步写入（见 useInventoryCsv）。
 * 这一层 composable 只管"白名单 + 分配 UI"。
 */
import { ref } from 'vue'
import { supabase } from '@/lib/supabase'

export interface StockGroup {
  id: string
  code: string           // 'A中鹏'
  display_name: string | null
  remark: string | null
  sku_count: number
  imported_at: string
  created_at: string
}

export interface StockGroupImportPreview {
  groups: Array<{
    code: string
    skuCount: number
    existing: boolean
  }>
  totalSkus: number
}

export function useStockGroups() {
  const groups = ref<StockGroup[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  /** 拉所有库存组（按 code 升序） */
  const fetchAll = async (): Promise<StockGroup[]> => {
    loading.value = true
    try {
      const { data, error: e } = await supabase
        .from('stock_groups')
        .select('*')
        .order('code')
      if (e) throw e
      groups.value = (data ?? []) as StockGroup[]
      return groups.value
    } catch (e: any) {
      error.value = e.message ?? String(e)
      return []
    } finally {
      loading.value = false
    }
  }

  /** 解析上传的 库存表.csv，返回预览 */
  const parseInventoryCsv = async (file: File): Promise<StockGroupImportPreview> => {
    const text = await file.text()
    // 使用 PapaParse 风格的简易 CSV 解析（首行是 BOM 表头）
    const cleaned = text.replace(/^\uFEFF/, '')
    const lines = cleaned.split(/\r?\n/).filter((l) => l.trim())
    if (lines.length < 2) {
      throw new Error('文件为空或只有表头')
    }
    const header = lines[0].split(',')
    const codeIdx = header.findIndex((h) => h.trim() === '客户组')
    if (codeIdx < 0) {
      throw new Error('找不到"客户组"列（应为 A 列）')
    }

    // 统计每个客户组下型号数
    const counts = new Map<string, number>()
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',')
      const code = cols[codeIdx]?.trim()
      if (!code) continue
      counts.set(code, (counts.get(code) ?? 0) + 1)
    }

    // 拉到已存在的
    const { data: existing } = await supabase
      .from('stock_groups')
      .select('code')
    const existingSet = new Set((existing ?? []).map((r: any) => r.code))

    const groups = Array.from(counts.entries()).map(([code, skuCount]) => ({
      code,
      skuCount,
      existing: existingSet.has(code),
    })).sort((a, b) => a.code.localeCompare(b.code))

    return {
      groups,
      totalSkus: lines.length - 1,
    }
  }

  /** 提交库存组入库（upsert by code） */
  const commitImport = async (preview: StockGroupImportPreview): Promise<{ upserted: number }> => {
    loading.value = true
    try {
      const rows = preview.groups.map((g) => ({
        code: g.code,
        sku_count: g.skuCount,
        imported_at: new Date().toISOString(),
      }))
      const { error: e } = await (supabase.from('stock_groups') as any)
        .upsert(rows, { onConflict: 'code' })
      if (e) throw e
      return { upserted: rows.length }
    } finally {
      loading.value = false
    }
  }

  /** 当前父账号绑定的所有库存组 code（白名单） */
  const fetchAssignedForParent = async (parentId: string): Promise<string[]> => {
    const { data, error: e } = await supabase
      .from('customer_group_mappings')
      .select('customer_group')
      .eq('account_id', parentId)
      .eq('is_active', true)
    if (e) return []
    return ((data ?? []) as Array<{ customer_group: string }>).map((r) => r.customer_group)
  }

  /** 给父账号绑定白名单（库存组 codes） */
  const assignForParent = async (parentId: string, groupCodes: string[]): Promise<void> => {
    loading.value = true
    try {
      // 1. 删除该父原有映射
      await supabase.from('customer_group_mappings').delete().eq('account_id', parentId)
      // 2. 写入新映射
      if (groupCodes.length === 0) return
      const rows = groupCodes.map((code) => ({
        customer_group: code,
        account_id: parentId,
        is_active: true,
        remark: 'admin 在 AccountsAdminPage 手动分配库存组',
      }))
      const { error: e } = await (supabase.from('customer_group_mappings') as any)
        .upsert(rows, { onConflict: 'customer_group' })
      if (e) throw e
    } finally {
      loading.value = false
    }
  }

  /**
   * 解析当前登录的用户属于哪个父账号（白名单查找）
   * 业务规则：auth.uid → users.account_id（父） → customer_group_mappings → 库存组 codes
   */
  const fetchMyAssignedGroups = async (parentId: string): Promise<string[]> => {
    return fetchAssignedForParent(parentId)
  }

  return {
    groups, loading, error,
    fetchAll,
    parseInventoryCsv,
    commitImport,
    fetchAssignedForParent,
    assignForParent,
    fetchMyAssignedGroups,
  }
}
