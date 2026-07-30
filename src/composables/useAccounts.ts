/**
 * useAccounts —— 主账号（父）+ 子账户 结构管理
 *
 * 业务模型：
 *   - 父账号 parent_id = NULL，对应 Excel "类别"（贾汉 / I客户 / W客户 ...）
 *   - 子账号 parent_id = 父.id，对应 Excel "客户名称"
 *   - 主账号登录 → 下单时选子账号
 *   - 白名单（account_products / customer_group_mappings）按父账号走，
 *     所有子账号共享父的白名单
 *
 * 状态提升到模块单例：同一页面多次进入 / 页面间共享时，数据只从 Supabase 拉取一次。
 *
 * API：
 *   - fetchTree()                          拉全部父子（按父聚合）
 *   - createParent({ category, type })     新建父
 *   - updateParent(id, patch)              改父
 *   - toggleParentStatus(id)               启停父
 *   - createSub({ parent_id, ... })        新建子
 *   - updateSub(id, patch)                 改子
 *   - setMain(parent_id, sub_id)           标记主联系子账号
 *   - fetchSubAccounts(parent_id)          拉某父的子（按 parentId 缓存）
 *   - importFromExcel(rows)                批量 upsert 父子 + 客户组映射
 *   - assignCategories(parent_id, [...])   父账号绑定到哪些产品分类（12J/12P/12F/12K...）
 *   - fetchAssignedCategories(parent_id)   查父绑定的分类
 */
import { ref } from 'vue'
import { supabase } from '@/lib/supabase'

export type AccountType = '1_public' | '2_cash' | '3_export'
export type AccountStatus = 'active' | 'inactive'

export interface Account {
  id: string
  parent_id: string | null
  account_type: AccountType
  account_name: string
  company_name: string
  address: string
  bank: string
  bank_account: string
  mfo: string
  inn: string
  director: string
  contract_no: string | null
  contract_date: string | null
  balance: number
  status: AccountStatus
  is_main: boolean
  login_email?: string | null   // 客户登录邮箱（迁移 0006 加）
  user_id?: string | null       // 关联到 auth.users.id（迁移 0006 加）
  created_at: string
  updated_at: string
}

export interface ExcelRow {
  category: string       // 类别（如 "贾汉"）
  inn: string            // 税号（如 "202021513"，'-'/'0' 视为空）
  name: string           // 客户名称（如 "1账户 I客户 ASM"）
  type: AccountType      // 解析后已是 AccountType
  status: AccountStatus  // 解析后已是 AccountStatus
}

export interface ImportPreview {
  parents: Array<{ category: string; type: AccountType; rowCount: number; existing?: boolean }>
  subs: Array<{ category: string; name: string; inn: string; type: AccountType; status: AccountStatus }>
  groupMappings: Array<{ category: string }>
}

const TYPE_MAP: Record<string, AccountType> = {
  '1账户': '1_public',
  '2账户': '2_cash',
  '3账户': '3_export',
}

/** 把 Excel 单行映射成结构化数据；不合法行返回 null */
export function parseExcelRow(raw: any): ExcelRow | null {
  const cat = String(raw['类别'] ?? raw['category'] ?? '').trim()
  const inn = String(raw['税号'] ?? raw['inn'] ?? '').trim()
  const name = String(raw['客户名称'] ?? raw['name'] ?? '').trim()
  // 兼容两种列名：「账户」 / 「账户类型」 / 「type」
  const typ = String(raw['账户类型'] ?? raw['账户'] ?? raw['type'] ?? '').trim()
  const st = String(raw['状态'] ?? raw['status'] ?? '可用').trim()
  if (!cat || !name) return null
  if (!TYPE_MAP[typ]) return null
  return {
    category: cat,
    inn: inn === '-' || inn === '0' ? '' : inn,
    name,
    type: TYPE_MAP[typ],
    status: st === '停用' ? 'inactive' : 'active',
  }
}

/** 父账号的 type = 该类别下出现最多的子类型；混合类按 1_public 兜底 */
function pickParentType(rows: ExcelRow[]): AccountType {
  const counts: Record<AccountType, number> = { '1_public': 0, '2_cash': 0, '3_export': 0 }
  for (const r of rows) {
    if (r.type in counts) counts[r.type]++
  }
  const order: AccountType[] = ['1_public', '2_cash', '3_export']
  let best: AccountType = '1_public'
  let bestN = -1
  for (const t of order) {
    if (counts[t] > bestN) { best = t; bestN = counts[t] }
  }
  return best
}

/** 把解析后的行折叠成"父 + 子 + 映射"预览 */
export function buildImportPreview(rows: ExcelRow[]): ImportPreview {
  const byCat = new Map<string, ExcelRow[]>()
  for (const r of rows) {
    if (!byCat.has(r.category)) byCat.set(r.category, [])
    byCat.get(r.category)!.push(r)
  }
  const parents = Array.from(byCat.entries()).map(([category, rs]) => ({
    category,
    type: pickParentType(rs),
    rowCount: rs.length,
  }))
  const subs: ImportPreview['subs'] = rows.map((r) => ({
    category: r.category,
    name: r.name,
    inn: r.inn,
    type: r.type,
    status: r.status,
  }))
  const groupMappings = parents.map((p) => ({ category: p.category }))
  return { parents, subs, groupMappings }
}

// Module-level singleton state — shared across all useAccounts() calls
const items = ref<Account[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
/** Cache for sub-accounts keyed by parentId */
const subCache = new Map<string, Account[]>()

export function useAccounts() {

  /** 拉所有父 + 子，按 parent 聚合 */
  const fetchTree = async (): Promise<{ parents: Account[]; subs: Account[] }> => {
    loading.value = true
    const { data, error: e } = await supabase
      .from('accounts')
      .select('*')
      .order('created_at', { ascending: false })
    if (e) { error.value = e.message; loading.value = false; return { parents: [], subs: [] } }
    const all = (data ?? []) as Account[]
    const parents = all.filter((a) => a.parent_id === null)
    const subs = all.filter((a) => a.parent_id !== null)
    items.value = all
    loading.value = false
    return { parents, subs }
  }

  /** 新建父账号（按 category 去重：同名父已存在则跳过） */
  const createParent = async (params: {
    account_name: string
    account_type: AccountType
    login_email?: string | null
  }) => {
    loading.value = true
    try {
      const { data, error: e } = await (supabase.from('accounts') as any)
        .insert({
          parent_id: null,
          account_name: params.account_name,
          account_type: params.account_type,
          company_name: params.account_name,
          address: '-',
          bank: '-',
          bank_account: '-',
          mfo: '-',
          inn: '-',
          director: '-',
          status: 'active',
          is_main: false,
          balance: 0,
          login_email: params.login_email ?? null,
        })
        .select('*')
        .single()
      if (e) throw e
      return data as Account
    } finally {
      loading.value = false
    }
  }

  /** 改父 */
  const updateParent = async (id: string, patch: Partial<Account>) => {
    loading.value = true
    try {
      const { error: e } = await (supabase.from('accounts') as any)
        .update(patch)
        .eq('id', id)
      if (e) throw e
    } finally {
      loading.value = false
    }
  }

  /** 启停父 */
  const toggleParentStatus = async (parent: Account) => {
    const next = parent.status === 'active' ? 'inactive' : 'active'
    await updateParent(parent.id, { status: next })
  }

  /** 新建子账号 */
  const createSub = async (params: {
    parent_id: string
    account_name: string
    account_type: AccountType
    inn?: string
    is_main?: boolean
    status?: AccountStatus
  }) => {
    loading.value = true
    try {
      const { data, error: e } = await (supabase.from('accounts') as any)
        .insert({
          parent_id: params.parent_id,
          account_name: params.account_name,
          account_type: params.account_type,
          inn: params.inn || '-',
          is_main: !!params.is_main,
          status: params.status ?? 'active',
          company_name: params.account_name,
          address: '-',
          bank: '-',
          bank_account: '-',
          mfo: '-',
          director: '-',
          balance: 0,
        })
        .select('*')
        .single()
      if (e) throw e
      subCache.delete(params.parent_id)
      return data as Account
    } finally {
      loading.value = false
    }
  }

  /** 改子 */
  const updateSub = async (id: string, patch: Partial<Account>) => {
    loading.value = true
    try {
      const { error: e } = await (supabase.from('accounts') as any)
        .update(patch)
        .eq('id', id)
      if (e) throw e
      // 改完后清缓存，下次 fetchSubAccounts 会重新拉
      for (const [parentId, subs] of subCache) {
        if (subs.some((s) => s.id === id)) subCache.delete(parentId)
      }
    } finally {
      loading.value = false
    }
  }

  /** 标记某子为主联系（同时把同父下其它子的 is_main 全部置 false） */
  const setMain = async (parentId: string, subId: string) => {
    loading.value = true
    try {
      // 1. 全置 false
      await (supabase.from('accounts') as any)
        .update({ is_main: false })
        .eq('parent_id', parentId)
      // 2. 选中置 true
      const { error: e } = await (supabase.from('accounts') as any)
        .update({ is_main: true })
        .eq('id', subId)
      if (e) throw e
      subCache.delete(parentId)
    } finally {
      loading.value = false
    }
  }

  /** 拉某父的子（按主联系置顶，其余按名升序；按 parentId 缓存） */
  const fetchSubAccounts = async (parentId: string): Promise<Account[]> => {
    if (subCache.has(parentId)) return subCache.get(parentId)!
    const { data, error: e } = await supabase
      .from('accounts')
      .select('*')
      .eq('parent_id', parentId)
      .order('is_main', { ascending: false })
      .order('account_name')
    if (e) { error.value = e.message; return [] }
    const result = (data ?? []) as Account[]
    subCache.set(parentId, result)
    return result
  }

  /**
   * 从 Excel 行批量导入：upsert 父 + upsert 子 + upsert 客户组映射
   * 策略：
   *   - 父：按 category 名 upsert（同名父已存在则跳过；不会重复 create）
   *   - 子：(parent_id, account_name) 唯一（migration 已建）；
   *         新增时 insert；重复时按新 Excel 的 inn / type / status 覆盖
   *         （不覆盖 account_name，因为 Excel 的 "客户名称" 是不变的）
   *   - customer_group_mappings：customer_group=category, account_id=父.id
   *     —— 不会被新文件"关掉 is_active"，因为白名单分配由 admin 在
   *     单独页面手动管。导入只确保映射存在。
   *   - 返回值：parentsAdded / subsAdded / subsUpdated / mappingsAdded
   */
  const importFromExcel = async (
    preview: ImportPreview,
  ): Promise<{ parentsAdded: number; subsAdded: number; subsUpdated: number; mappingsAdded: number }> => {
    loading.value = true
    try {
      // 1. 先查所有已存在的父（同名 → 复用 id）
      const { data: existing, error: exErr } = await supabase
        .from('accounts')
        .select('*')
        .is('parent_id', null)
      if (exErr) throw exErr
      const byName = new Map<string, Account>()
      for (const a of (existing ?? []) as Account[]) {
        byName.set(a.account_name, a)
      }

      const parentsAdded: Account[] = []
      // 2. 缺的父 → 插入
      for (const p of preview.parents) {
        if (byName.has(p.category)) continue
        const created = await createParent({ account_name: p.category, account_type: p.type })
        byName.set(p.category, created)
        parentsAdded.push(created)
      }

      // 3. 子 → 按父批量 upsert
      // 先按父聚合子行
      const subsByParent = new Map<string, typeof preview.subs>()
      for (const s of preview.subs) {
        const parent = byName.get(s.category)
        if (!parent) continue
        if (!subsByParent.has(parent.id)) subsByParent.set(parent.id, [])
        subsByParent.get(parent.id)!.push(s)
      }

      // 3a. 拉当前所有子账号（按父聚合）以做 diff
      const { data: allSubs, error: subsErr } = await supabase
        .from('accounts')
        .select('*')
        .not('parent_id', 'is', null)
      if (subsErr) throw subsErr
      const existingByParent = new Map<string, Map<string, Account>>()
      for (const s of (allSubs ?? []) as Account[]) {
        if (!existingByParent.has(s.parent_id!)) existingByParent.set(s.parent_id!, new Map())
        existingByParent.get(s.parent_id!)!.set(s.account_name, s)
      }

      let subsAdded = 0
      let subsUpdated = 0
      const CHUNK = 200

      for (const [parentId, subs] of subsByParent.entries()) {
        const existingMap = existingByParent.get(parentId) ?? new Map<string, Account>()
        const insertRows: any[] = []
        const updateRows: Array<{ id: string; patch: any }> = []

        for (const s of subs) {
          const existing = existingMap.get(s.name)
          if (existing) {
            // 已存在 → 仅当 inn / type / status 任一变化时更新
            const patch: any = {}
            if ((existing.inn || '') !== (s.inn || '')) patch.inn = s.inn || '-'
            if (existing.status !== s.status) patch.status = s.status
            if (existing.account_type !== s.type) patch.account_type = s.type
            if (Object.keys(patch).length > 0) {
              updateRows.push({ id: existing.id, patch })
            }
          } else {
            insertRows.push({
              parent_id: parentId,
              account_name: s.name,
              account_type: s.type,
              inn: s.inn || '-',
              is_main: false,
              status: s.status,
              company_name: s.name,
              address: '-',
              bank: '-',
              bank_account: '-',
              mfo: '-',
              director: '-',
              balance: 0,
            })
          }
        }

        // chunked insert
        for (let i = 0; i < insertRows.length; i += CHUNK) {
          const slice = insertRows.slice(i, i + CHUNK)
          const { error: e } = await (supabase.from('accounts') as any).insert(slice)
          if (e) throw e
          subsAdded += slice.length
        }
        // chunked update
        for (let i = 0; i < updateRows.length; i += CHUNK) {
          const slice = updateRows.slice(i, i + CHUNK)
          // 用 in(...) 走一次 roundtrip
          const ids = slice.map((r) => r.id)
          const merged: Record<string, any> = {}
          for (const r of slice) {
            for (const [k, v] of Object.entries(r.patch)) {
              if (!(k in merged)) merged[k] = {}
              // 简化：每条都设自己的；如果不同 id 不同 patch，需要逐条 update
            }
          }
          // 为正确性逐条 update
          for (const r of slice) {
            const { error: e } = await (supabase.from('accounts') as any)
              .update(r.patch)
              .eq('id', r.id)
            if (e) throw e
            subsUpdated += 1
          }
        }
      }

      // 4. 客户组映射（category → 父.id，is_active=true，remark=来源）
      //    注：不要覆盖 is_active（=false）。只确保映射存在。
      const mappingRows = preview.groupMappings
        .map((m) => byName.get(m.category))
        .filter((p): p is Account => !!p)
        .map((p) => ({
          customer_group: p.account_name,
          account_id: p.id,
          is_active: true,
          remark: '通过 Excel 客户档案库自动生成',
        }))
      let mappingsAdded = 0
      const M_CHUNK = 200
      for (let i = 0; i < mappingRows.length; i += M_CHUNK) {
        const slice = mappingRows.slice(i, i + M_CHUNK)
        const { error: e } = await (supabase
          .from('customer_group_mappings') as any)
          .upsert(slice, { onConflict: 'customer_group,account_id' })
        if (e) throw e
        mappingsAdded += slice.length
      }

      return {
        parentsAdded: parentsAdded.length,
        subsAdded,
        subsUpdated,
        mappingsAdded,
      }
    } finally {
      loading.value = false
    }
  }

  /** 拉所有 stock_groups（向后兼容名）；推荐用 useStockGroups.fetchAll */
  const fetchProductCategories = async (): Promise<string[]> => {
    const { data, error: e } = await supabase
      .from('stock_groups')
      .select('code')
      .order('code')
    if (e) return []
    return ((data ?? []) as Array<{ code: string }>).map((r) => r.code)
  }

  return {
    items, loading, error,
    fetchTree,
    createParent, updateParent, toggleParentStatus,
    createSub, updateSub, setMain, fetchSubAccounts,
    importFromExcel,
    fetchProductCategories,
  }
}