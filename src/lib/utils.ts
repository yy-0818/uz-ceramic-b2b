/**
 * 通用 cn 工具 —— 合并 className，支持 shadcn 风格条件类
 */
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 数字格式化：m² */
export function fmtM2(n: number) {
  return `${n.toFixed(2)} м²`
}

/** 数字格式化：箱 */
export function fmtBoxes(n: number) {
  return `${n} ящ.`
}
