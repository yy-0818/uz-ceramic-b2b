/**
 * useOrderAttachments —— 订单附件（图片）上传 + 绑定
 *
 * 业务场景：
 *   客户在下单确认页上传"物流司机信息图"等图片作为备注补充。
 *   提交订单时一并 attach 到新订单。
 *
 * 流程：
 *   1. 上传:  client 选图 → 校验 size / mime → upload 到
 *             storage 'order-attachments' bucket, 路径 'pending/{account_id}/{uuid}.{ext}'
 *   2. 绑定:  订单成功创建后, 把 pending 路径 + 元数据 insert 到
 *             public.order_attachments 表. 审核员/财务/仓库读详情时拿到
 *             storage_path → 拼 public URL 显示.
 *
 * 设计权衡:
 *   - 路径用 'pending/' 而不是 '{account_id}/{order_id}/' 因为 order_id 在
 *     upload 时尚不存在. 失败时 pending 文件留在 storage 但无 DB 引用,
 *     不影响订单数据 (浪费一点空间, 可后续清理).
 *   - 不在 upload 阶段直接 insert order_attachments: 因为 order_id 未知,
 *     写表会失败. attachToOrder 是订单已创建后才调用的.
 *
 * Bucket 配置见 supabase/migrations/0013_order_attachments_bucket.sql.
 */
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'

const BUCKET = 'order-attachments'
const MAX_SIZE = 5 * 1024 * 1024   // 5 MB (与 bucket file_size_limit 一致)
const ALLOWED_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
]

export interface PendingAttachment {
  /** storage 中的路径, 形如 'pending/{account_id}/{uuid}.jpg' */
  storage_path: string
  mime: string
  size_bytes: number
  caption?: string
  /** 本地预览用 object URL (revoke 时清理) */
  local_url: string
}

export interface UploadOptions {
  accountId: string
  caption?: string
  onProgress?: (percent: number) => void
}

export interface AttachToOrderParams {
  orderId: string
  accountId: string
  uploadedBy?: string | null
}

/**
 * 上传一张图片到 storage (pending 路径), 返回 metadata + local preview url.
 * 上传失败抛 Error, 由调用方 toast.
 */
export async function uploadOrderAttachment(
  file: File,
  options: UploadOptions,
): Promise<PendingAttachment> {
  if (!ALLOWED_MIMES.includes(file.type)) {
    throw new Error(`不支持的图片格式: ${file.type || '未知'}（仅 jpg / png / webp / heic）`)
  }
  if (file.size > MAX_SIZE) {
    throw new Error(`图片过大: ${(file.size / 1024 / 1024).toFixed(1)} MB（上限 5 MB）`)
  }

  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const uuid = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const path = `pending/${options.accountId}/${uuid}.${ext}`

  const local_url = URL.createObjectURL(file)

  const { onProgress } = options
  if (onProgress) {
    // storage 客户端不暴露进度, 模拟递增直到完成
    let p = 0
    const tick = setInterval(() => {
      p = Math.min(90, p + Math.random() * 12 + 5)
      onProgress(Math.round(p))
    }, 100)
    try {
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type, cacheControl: '3600' })
      if (error) { clearInterval(tick); URL.revokeObjectURL(local_url); throw error }
      onProgress(100)
    } catch (e) {
      URL.revokeObjectURL(local_url)
      throw e
    } finally {
      clearInterval(tick)
    }
  } else {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type, cacheControl: '3600' })
    if (error) { URL.revokeObjectURL(local_url); throw error }
  }

  return {
    storage_path: path,
    mime: file.type,
    size_bytes: file.size,
    caption: options.caption,
    local_url,
  }
}

/**
 * 把 pending attachments 绑定到已创建的订单 (一行一个).
 * 批量 insert, 部分失败抛错 (全部不写).
 */
export async function attachToOrder(
  attachments: PendingAttachment[],
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
 * 删除已上传的 pending 文件 (用户取消 / 提交失败时回滚).
 * 静默吞错 (storage 已无 object 时忽略).
 */
export async function removePending(attachments: PendingAttachment[]): Promise<void> {
  if (attachments.length === 0) return
  const paths = attachments.map((a) => a.storage_path)
  await supabase.storage.from(BUCKET).remove(paths)
  for (const a of attachments) URL.revokeObjectURL(a.local_url)
}

/** 拼 public URL (bucket 是 PUBLIC, 直接拼) */
export function attachmentPublicUrl(storage_path: string): string {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storage_path)
  return data.publicUrl
}

/**
 * useOrderAttachments —— reactive 容器, 在 CheckoutPage 中跟踪用户上传中的图.
 */
export function useOrderAttachments() {
  const items = ref<Array<PendingAttachment & { progress?: number; error?: string }>>([])
  const uploading = ref(false)

  const add = async (file: File, accountId: string, caption?: string) => {
    if (items.value.length >= 5) {
      throw new Error('最多 5 张图片')
    }
    uploading.value = true
    const placeholder = {
      storage_path: '',
      mime: file.type,
      size_bytes: file.size,
      caption,
      local_url: URL.createObjectURL(file),
      progress: 0,
    }
    items.value.push(placeholder)
    try {
      const result = await uploadOrderAttachment(file, {
        accountId,
        caption,
        onProgress: (p) => { placeholder.progress = p },
      })
      // 替换 placeholder 为真结果
      const idx = items.value.indexOf(placeholder)
      if (idx >= 0) items.value.splice(idx, 1, { ...result, progress: 100 })
    } catch (e: any) {
      const idx = items.value.indexOf(placeholder)
      if (idx >= 0) {
        items.value[idx] = {
          ...placeholder,
          error: e?.message ?? String(e),
        }
      }
      throw e
    } finally {
      uploading.value = false
    }
  }

  const remove = async (idx: number) => {
    const it = items.value[idx]
    if (!it) return
    items.value.splice(idx, 1)
    if (it.storage_path) {
      try {
        await removePending([it])
      } catch {
        // 静默
      }
    } else if (it.local_url) {
      URL.revokeObjectURL(it.local_url)
    }
  }

  const reset = async () => {
    const paths = items.value.filter((i) => i.storage_path).map((i) => i.storage_path)
    if (paths.length > 0) {
      try { await supabase.storage.from(BUCKET).remove(paths) } catch { /* ignore */ }
    }
    for (const it of items.value) URL.revokeObjectURL(it.local_url)
    items.value = []
  }

  const successful = computed(() =>
    items.value.filter((i) => !!i.storage_path && !i.error),
  )

  return { items, uploading, add, remove, reset, successful }
}
