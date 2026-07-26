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

export async function uploadProductImage(
  productId: string,
  file: File,
): Promise<string> {
  if (!ALLOWED.includes(file.type)) {
    throw new Error(`不支持的文件类型: ${file.type}（仅 jpg/png/webp/gif）`)
  }
  if (file.size > MAX_SIZE) {
    throw new Error(`文件过大: ${(file.size / 1024 / 1024).toFixed(1)} MB（上限 5 MB）`)
  }
  const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
  const path = `products/${productId}.${ext}`

  const { error: upErr } = await supabase.storage
    .from('product-images')
    .upload(path, file, {
      upsert: true,
      contentType: file.type,
      cacheControl: '3600',
    })
  if (upErr) throw upErr

  const { data } = supabase.storage
    .from('product-images')
    .getPublicUrl(path)

  const publicUrl = data.publicUrl
  // 写回 products.image_url
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: dbErr } = await (supabase as any)
    .from('products')
    .update({ image_url: publicUrl })
    .eq('id', productId)
  if (dbErr) throw dbErr

  return publicUrl
}

export async function removeProductImage(productId: string): Promise<void> {
  // 尝试匹配常见扩展名删 storage
  const candidates = ['jpg', 'jpeg', 'png', 'webp', 'gif']
  for (const ext of candidates) {
    await supabase.storage
      .from('product-images')
      .remove([`products/${productId}.${ext}`])
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: dbErr } = await (supabase as any)
    .from('products')
    .update({ image_url: null })
    .eq('id', productId)
  if (dbErr) throw dbErr
}