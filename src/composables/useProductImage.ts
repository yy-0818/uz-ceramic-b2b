/**
 * useProductImage —— 商品图片上传
 *
 * 流程：
 *   1. admin 选图 → 校验大小 / 类型
 *   2. 上传至 Supabase Storage bucket "product-images"
 *   3. 拿到 public URL → 写回 products.image_url
 *
 * 路径策略：products/{product_id}.{ext}
 *   - 用 product_id 做文件名 → 同一商品多次上传自动覆盖
 *   - 不带时间戳 → URL 稳定好记
 */
import { supabase } from '@/lib/supabase'

const MAX_SIZE = 5 * 1024 * 1024   // 5 MB
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export interface UploadProductImageOptions {
  /** 上传进度回调 0~100 */
  onProgress?: (percent: number) => void
  /** 模拟进度（当 storage 不发进度事件时使用） */
  simulateProgress?: boolean
}

export async function uploadProductImage(
  productId: string,
  file: File,
  options: UploadProductImageOptions = {},
): Promise<string> {
  if (!ALLOWED.includes(file.type)) {
    throw new Error(`不支持的文件类型: ${file.type}（仅 jpg/png/webp/gif）`)
  }
  if (file.size > MAX_SIZE) {
    throw new Error(`文件过大: ${(file.size / 1024 / 1024).toFixed(1)} MB（上限 5 MB）`)
  }
  const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
  const path = `products/${productId}.${ext}`

  const { onProgress, simulateProgress } = options
  if (onProgress) {
    if (simulateProgress) {
      // Storage 客户端不暴露进度事件 — 用定时器模拟直到完成/失败
      let p = 0
      const tick = setInterval(() => {
        p = Math.min(90, p + Math.random() * 12 + 5)
        onProgress(Math.round(p))
      }, 100)
      try {
        const { error: upErr } = await supabase.storage
          .from('product-images')
          .upload(path, file, { upsert: true, contentType: file.type, cacheControl: '3600' })
        if (upErr) { clearInterval(tick); throw upErr }
        onProgress(100)
      } finally {
        clearInterval(tick)
      }
    } else {
      onProgress(50)
      const { error: upErr } = await supabase.storage
        .from('product-images')
        .upload(path, file, { upsert: true, contentType: file.type, cacheControl: '3600' })
      if (upErr) throw upErr
      onProgress(100)
    }
  } else {
    const { error: upErr } = await supabase.storage
      .from('product-images')
      .upload(path, file, { upsert: true, contentType: file.type, cacheControl: '3600' })
    if (upErr) throw upErr
  }

  const { data } = supabase.storage
    .from('product-images')
    .getPublicUrl(path)

  const publicUrl = data.publicUrl
   
  const { error: dbErr } = await (supabase as any)
    .from('products')
    .update({ image_url: publicUrl })
    .eq('id', productId)
  if (dbErr) throw dbErr

  return publicUrl
}

export async function removeProductImage(productId: string): Promise<void> {
  const candidates = ['jpg', 'jpeg', 'png', 'webp', 'gif']
  for (const ext of candidates) {
    await supabase.storage
      .from('product-images')
      .remove([`products/${productId}.${ext}`])
  }
   
  const { error: dbErr } = await (supabase as any)
    .from('products')
    .update({ image_url: null })
    .eq('id', productId)
  if (dbErr) throw dbErr
}

/** 文件大小 → "1.2 MB" / "820 KB" */
export function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** mime → "PNG" / "JPG" / "WEBP" */
export function fmtFileType(mime: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'JPG',
    'image/png': 'PNG',
    'image/webp': 'WEBP',
    'image/gif': 'GIF',
  }
  return map[mime] ?? mime.replace('image/', '').toUpperCase()
}
