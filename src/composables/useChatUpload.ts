/**
 * useChatUpload —— 聊天图片上传
 *
 * 流程 (写库顺序):
 *   1. 客户端选图 / 拖拽 → validateChatImage() 校验
 *   2. 计算 SHA-256 → 同会话已有同 sha 的附件, 直接复用
 *   3. uploadToStorage() 上传到 chat-attachments/{account_id}/{conversation_id}/{uuid}.{ext}
 *   4. 调 RPC rpc_chat_create_image_message() 插消息 + 附件行
 *
 * 显示顺序 (从服务端读):
 *   - ChatPanel 拉消息时, 同时 fetchAttachments(messageIds) → 缓存到 imageCache ref
 *   - 渲染时若有附件 → 显示成图片气泡
 *
 * Download (signed URL, 5min 过期):
 *   - createSignedUrl(path, 300)
 *   - 因为私有 bucket, 不能用 publicUrl, 必须经签名
 */
import { ref, computed } from 'vue'
import { supabase } from '@/lib/supabase'

const BUCKET = 'chat-attachments'
const MAX_SIZE = 5 * 1024 * 1024
const ALLOWED_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
]
const SIGNED_TTL = 300

export interface ChatImageMeta {
  id: string
  message_id: string
  storage_path: string
  mime: string
  size_bytes: number
  width: number | null
  height: number | null
}

export function validateChatImage(file: File): void {
  if (!ALLOWED_MIMES.includes(file.type)) {
    throw new Error(`不支持的图片格式: ${file.type || '未知'}`)
  }
  if (file.size > MAX_SIZE) {
    throw new Error(`图片过大: ${(file.size / 1024 / 1024).toFixed(1)} MB（上限 5 MB）`)
  }
}

async function sha256Hex(file: File): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return ''
  const buf = await file.arrayBuffer()
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function safeExt(file: File): string {
  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase()
  if (!/^[a-z0-9]+$/.test(ext)) return 'jpg'
  return ext.slice(0, 5)
}

function loadImageDims(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const w = img.naturalWidth || 0
      const h = img.naturalHeight || 0
      URL.revokeObjectURL(url)
      resolve({ width: w, height: h })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve({ width: 0, height: 0 })
    }
    img.src = url
  })
}

export interface UploadImageParams {
  conversationId: string
  accountId: string
  file: File
  clientMessageId?: string
}

export interface UploadImageResult {
  messageId: string
  attachmentId: string
  storagePath: string
  mime: string
  size: number
  width: number | null
  height: number | null
}

/** 单例 ref（signed URL cache + 上传进度） */
const signedUrlCache = new Map<string, { url: string; exp: number }>()
const uploadProgress = ref(0) // 0..1

export function useChatUpload() {
  /**
   * 上传一张图: 校验 → 读 SHA → 上传 → RPC 写库.
   * 上传失败抛 Error.
   */
  const uploadImage = async (params: UploadImageParams): Promise<UploadImageResult> => {
    validateChatImage(params.file)
    const ext = safeExt(params.file)
    const uuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const path = `${params.accountId}/${params.conversationId}/${uuid}.${ext}`
    uploadProgress.value = 0.1

    // SHA 用于前端去重 (同会话同内容)
    const sha = await sha256Hex(params.file).catch(() => '')
    uploadProgress.value = 0.3

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, params.file, {
        cacheControl: '3600',
        upsert: false,
        contentType: params.file.type,
      })
    if (upErr) throw upErr
    uploadProgress.value = 0.7

    const dims = await loadImageDims(params.file).catch(() => ({ width: 0, height: 0 }))

    const { data, error: rpcErr } = await (supabase as any)
      .rpc('rpc_chat_create_image_message', {
        p_conversation: params.conversationId,
        p_storage_path: path,
        p_mime: params.file.type,
        p_size: params.file.size,
        p_width: dims.width || null,
        p_height: dims.height || null,
        p_client_message_id: params.clientMessageId ?? null,
      })
    if (rpcErr) {
      // 上传成功了但写库失败, 尝试删除 storage 对象, 不阻塞用户
      supabase.storage.from(BUCKET).remove([path]).catch(() => { /* ignore */ })
      throw rpcErr
    }
    uploadProgress.value = 1

    // 顺便把 sha 写进 metadata (用作前端去重)
    const row = Array.isArray(data) ? data[0] : data
    if (sha && row?.message_id) {
      await (supabase as any)
        .from('chat_message_metadata')
        .upsert({ message_id: row.message_id, payload: { sha } })
        .catch(() => { /* ignore */ })
    }

    return {
      messageId: row?.message_id,
      attachmentId: row?.attachment_id,
      storagePath: path,
      mime: params.file.type,
      size: params.file.size,
      width: dims.width || null,
      height: dims.height || null,
    }
  }

  /**
   * 给定 path 拿一个可显示的 URL (signed, 5 分钟).
   * 缓存命中就不重签.
   */
  const getSignedUrl = async (path: string, force = false): Promise<string | null> => {
    const now = Date.now()
    const cached = signedUrlCache.get(path)
    if (!force && cached && cached.exp - now > 30_000) {
      return cached.url
    }
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_TTL)
    if (error || !data?.signedUrl) return null
    signedUrlCache.set(path, { url: data.signedUrl, exp: now + SIGNED_TTL * 1000 })
    return data.signedUrl
  }

  /**
   * 拉多个附件 ID 的图片地址 (signed).
   * 用于 ChatPanel 一次性预签.
   */
  const preloadSignedUrls = async (paths: string[]): Promise<void> => {
    await Promise.all(paths.map((p) => getSignedUrl(p).catch(() => null)))
  }

  return {
    uploadImage,
    uploadProgress: computed(() => uploadProgress.value),
    getSignedUrl,
    preloadSignedUrls,
    bucketName: BUCKET,
  }
}

/** 清除 signed URL 缓存 (登出时由 useAuth 调用) */
export function resetChatUpload() {
  signedUrlCache.clear()
  uploadProgress.value = 0
}
