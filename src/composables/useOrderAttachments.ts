/**
 * useOrderAttachments —— 订单附件（图片）本地暂存 + 提交时上传
 *
 * 业务场景：
 *   客户在下单确认页上传"物流司机信息图"等图片作为备注补充。
 *   提交订单时一并 upload 到 storage, 然后 attach 到新订单。
 *
 * 流程：
 *   1. 选图阶段:  client 选图 → 校验 size / mime → 创建 blob URL 本地预览
 *                → push 到 items.value. **不上传, 不占 storage, 不写 DB.**
 *   2. 提交订单:  订单 id 已创建 → 遍历 items 逐张 upload 到
 *                '{account_id}/{order_id}/{uuid}.{ext}' → 全部成功后
 *                attachToOrder() bulk insert order_attachments 表.
 *
 * 设计权衡:
 *   - 延迟上传而不是"选图立刻上传":
 *     1) 避免用户挑选后取消 / 改主意时遗留 pending/ 孤儿文件
 *     2) 节省带宽 (客户选 5 张后只上传 1 张也常见)
 *     3) 路径可以用最终 order_id, 不用 pending/ 魔法前缀
 *     4) 失败即整体回滚, 订单不创建
 *   - heic 格式: 允许上传 (server 端可能支持), 但本地预览大概率失败
 *     因为浏览器 <img> 不支持 heic. 选图时给警告, 但不阻止上传.
 *
 * Bucket 配置见 supabase/migrations/0013_order_attachments_bucket.sql.
 */
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'

const BUCKET = 'order-attachments'
const MAX_SIZE = 5 * 1024 * 1024   // 5 MB (与 bucket file_size_limit 一致)
export const MAX_ATTACHMENTS = 5
const ALLOWED_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
]
/** 浏览器 <img> 实际能渲染的格式. heic 不在其中 — 大多数浏览器不支持. */
const BROWSER_RENDERABLE = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])

export interface PendingAttachment {
  /** 原始 File 引用. 上传时读这个. */
  file: File
  /** 本地预览 object URL (life-cycle: items 数组期间有效, reset/remove 时 revoke). */
  local_url: string
  mime: string
  size_bytes: number
  caption?: string
  /**
   * 上传后的 storage path. 选图阶段为空; 提交订单成功后回填.
   * 提交失败 / 上传失败时保持空.
   */
  storage_path: string
}

/** 给外部用的"已成功上传"视图 (attachToOrder 调用). */
export interface UploadedAttachment {
  storage_path: string
  mime: string
  size_bytes: number
  caption?: string
  /** revoke 用 — 提交后也可保留 local_url, 但通常提交后会 reset() */
  local_url: string
}

export interface UploadOptions {
  accountId: string
  orderId: string
  caption?: string
  onProgress?: (percent: number) => void
}

export interface AttachToOrderParams {
  orderId: string
  accountId: string
  uploadedBy?: string | null
}

/**
 * 检测 file 是否是浏览器能渲染的格式. 他格式 (heic) 允许上传但不预览.
 */
export function isBrowserRenderable(mime: string): boolean {
  return BROWSER_RENDERABLE.has(mime)
}

/**
 * 选图阶段 (不上传):
 * 校验 + 创建本地预览. 失败抛 Error, 由调用方 toast.
 */
export function validateAttachment(file: File): void {
  if (!ALLOWED_MIMES.includes(file.type)) {
    throw new Error(
      `不支持的图片格式: ${file.type || '未知'}（仅 jpg / png / webp / heic）`,
    )
  }
  if (file.size > MAX_SIZE) {
    throw new Error(
      `图片过大: ${(file.size / 1024 / 1024).toFixed(1)} MB（上限 5 MB）`,
    )
  }
}

/**
 * 上传一张图片到 storage (按最终 order_id 路径), 返回 metadata + 新 local_url (revoke 用).
 * 上传失败抛 Error, 由调用方 toast + 整体回滚.
 */
export async function uploadOrderAttachment(
  file: File,
  options: UploadOptions,
): Promise<UploadedAttachment> {
  const ext = (file.name.split('.').pop() ?? 'jpg')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') || 'jpg'
  const uuid = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  // 路径第一段必须是 account_id 以满足 storage RLS policy
  // (order_attachments_insert_customer 要求 foldername(name)[1] = current_account_id())
  // 第二段用最终 order_id, 不再用 pending/
  const path = `${options.accountId}/${options.orderId}/${uuid}.${ext}`

  const { onProgress } = options
  if (onProgress) {
    let p = 0
    const tick = setInterval(() => {
      p = Math.min(90, p + Math.random() * 12 + 5)
      onProgress(Math.round(p))
    }, 100)
    try {
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type, cacheControl: '3600' })
      if (error) { clearInterval(tick); throw error }
      onProgress(100)
    } finally {
      clearInterval(tick)
    }
  } else {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type, cacheControl: '3600' })
    if (error) throw error
  }

  return {
    storage_path: path,
    mime: file.type,
    size_bytes: file.size,
    caption: options.caption,
    local_url: '',         // 已经在调用方持有的本地 preview URL
  }
}

/**
 * 把 uploaded attachments 绑定到已创建的订单 (一行一个).
 * 批量 insert, 部分失败抛错 (全部不写).
 */
export async function attachToOrder(
  attachments: UploadedAttachment[],
  params: AttachToOrderParams,
): Promise<void> {
  if (attachments.length === 0) return
  const rows = attachments.map((a) => ({
    order_id: params.orderId,
    account_id: params.accountId,
    storage_path: a.storage_path,
    mime: a.mime,
    size_bytes: a.size_bytes,
    caption: a.caption ?? null,
    uploaded_by: params.uploadedBy ?? null,
  }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('order_attachments')
    .insert(rows)
  if (error) throw error
}

/**
 * 删除一组已上传的 storage 对象 (失败回滚 / 客户取消订单后清理).
 * 静默吞错 (storage 已无 object 时忽略).
 */
export async function removeStorageObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return
  try {
    await supabase.storage.from(BUCKET).remove(paths)
  } catch {
    // 静默
  }
}

export interface OrderAttachmentRow {
  id: string
  order_id: string
  account_id: string
  storage_path: string
  mime: string
  size_bytes: number
  caption: string | null
  uploaded_by: string | null
  created_at: string
}

/**
 * 拉取指定订单的全部附件元数据。
 * 由 OrderDetailPage 调用，配合 attachmentPublicUrl() 拼图。
 *
 * RLS：
 *   - admin 走 order_attachments_admin_all 全权
 *   - 客户走 order_attachments_read（按 account_id 父账号子树）
 */
export async function fetchOrderAttachments(orderId: string): Promise<OrderAttachmentRow[]> {
  const { data, error } = await supabase
    .from('order_attachments')
    .select('id, order_id, account_id, storage_path, mime, size_bytes, caption, uploaded_by, created_at')
    .eq('order_id', orderId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as OrderAttachmentRow[]
}

/**
 * 拼 public URL（bucket 是 PUBLIC 时直接拼）。
 * 失败/老订单路径漂移时, 详情页会回退到 signedUrl。
 */
export function attachmentPublicUrl(storage_path: string): string {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storage_path)
  return data.publicUrl
}

/**
 * 拼签名 URL（bucket 是 PRIVATE 时使用）。
 * 有效期 1 小时, 详情页一次性使用足够。
 * 失败返回 null（object 不存在 / 权限拒绝）。
 */
export async function attachmentSignedUrl(storage_path: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storage_path, 3600)
  if (error) return null
  return data?.signedUrl ?? null
}

/**
 * useOrderAttachments —— reactive 容器.
 * 选图阶段只持有本地 File + blob URL. 提交订单时统一上传.
 */
export function useOrderAttachments() {
  const items = ref<Array<PendingAttachment & { progress?: number; error?: string }>>([])
  const uploading = ref(false)

  /**
   * 选图阶段: 校验 + 创建本地预览, push 到 items.
   * 立即返回 (同步). 客户端不调用 storage.
   */
  const add = (file: File, _unusedAccountId: string, caption?: string) => {
    if (items.value.length >= MAX_ATTACHMENTS) {
      throw new Error(`最多 ${MAX_ATTACHMENTS} 张图片`)
    }
    validateAttachment(file)
    const entry: PendingAttachment & { progress?: number; error?: string } = {
      file,
      local_url: URL.createObjectURL(file),
      mime: file.type,
      size_bytes: file.size,
      caption,
      storage_path: '',
      progress: 0,
    }
    items.value.push(entry)
    return entry
  }

  const remove = (idx: number) => {
    const it = items.value[idx]
    if (!it) return
    items.value.splice(idx, 1)
    if (it.local_url) URL.revokeObjectURL(it.local_url)
  }

  /**
   * 提交订单时调用: 逐张上传到 storage.
   * @param orderId 已创建的订单 id
   * @param accountId 主账号 id (RLS 路径第一段)
   * @param uploadedBy 操作用户 user id (audit 字段)
   * @returns 上传成功的 attachment 列表 (供 attachToOrder 用)
   * 失败抛 Error. 调用方应整体回滚 (订单 + 已经上传成功的对象).
   */
  const uploadAll = async (
    orderId: string,
    accountId: string,
    uploadedBy?: string | null,
  ): Promise<UploadedAttachment[]> => {
    const list = items.value
    if (list.length === 0) return []
    uploading.value = true
    const uploaded: UploadedAttachment[] = []
    const uploadedStoragePaths: string[] = []   // 失败回滚用
    try {
      for (let i = 0; i < list.length; i++) {
        const it = list[i]
        it.progress = 0
        it.error = undefined
        try {
          const result = await uploadOrderAttachment(it.file, {
            accountId,
            orderId,
            caption: it.caption,
            onProgress: (p) => { it.progress = p },
          })
          it.storage_path = result.storage_path
          uploaded.push({
            storage_path: result.storage_path,
            mime: it.mime,
            size_bytes: it.size_bytes,
            caption: it.caption,
            local_url: it.local_url,
          })
          uploadedStoragePaths.push(result.storage_path)
        } catch (e: any) {
          it.error = e?.message ?? String(e)
          // 失败: 删除已上传的, 抛错
          throw e
        }
      }
      // 全部上传成功 → bulk insert order_attachments
      await attachToOrder(uploaded, { orderId, accountId, uploadedBy })
      return uploaded
    } catch (e) {
      // 回滚: 删除已 upload 的 storage 对象
      if (uploadedStoragePaths.length > 0) {
        await removeStorageObjects(uploadedStoragePaths)
      }
      throw e
    } finally {
      uploading.value = false
    }
  }

  /**
   * 清本地状态, 不碰 storage.
   * 订单提交成功后调用 — storage 里的对象已被 order_attachments 表引用,
   * 不能删.
   */
  const reset = () => {
    for (const it of items.value) {
      if (it.local_url) URL.revokeObjectURL(it.local_url)
    }
    items.value = []
  }

  /**
   * 强制清理本地 + 已上传的 storage 对象.
   * 仅用于: 订单创建失败 / 用户取消下单 / 整批回滚时.
   */
  const purge = async () => {
    const paths = items.value
      .filter((i) => i.storage_path)
      .map((i) => i.storage_path)
    if (paths.length > 0) {
      await removeStorageObjects(paths)
    }
    reset()
  }

  const successful = computed(() =>
    items.value.filter((i) => !!i.storage_path && !i.error),
  )

  return { items, uploading, add, remove, reset, purge, uploadAll, successful }
}
