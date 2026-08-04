/**
 * 格式化工具集
 * 统一日期、数字、文本等格式化处理
 */

// ============================================================================
// 日期时间格式化
// ============================================================================

const RELATIVE_THRESHOLDS = {
  now: 30 * 1000,       // 30秒内
  minute: 60 * 1000,     // 1分钟内
  hour: 60 * 60 * 1000,  // 1小时内
  day: 24 * 60 * 60 * 1000, // 1天内
}

/**
 * 相对时间格式化（聊天消息时间戳等场景）
 * @param isoString ISO 日期字符串
 * @returns 相对时间字符串
 */
export function relativeTime(isoString: string): string {
  if (!isoString) return ''
  const date = new Date(isoString)
  const diff = Date.now() - date.getTime()

  if (diff < RELATIVE_THRESHOLDS.now) {
    return 'just now'
  }
  if (diff < RELATIVE_THRESHOLDS.minute) {
    const seconds = Math.floor(diff / 1000)
    return `${seconds}s ago`
  }
  if (diff < RELATIVE_THRESHOLDS.hour) {
    const minutes = Math.floor(diff / RELATIVE_THRESHOLDS.minute)
    return `${minutes}m ago`
  }
  if (diff < RELATIVE_THRESHOLDS.day) {
    const hours = Math.floor(diff / RELATIVE_THRESHOLDS.hour)
    return `${hours}h ago`
  }
  if (diff < 7 * RELATIVE_THRESHOLDS.day) {
    const days = Math.floor(diff / RELATIVE_THRESHOLDS.day)
    return `${days}d ago`
  }

  // 超过7天显示完整日期
  return formatDate(date)
}

/**
 * 格式化日期
 */
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

/**
 * 格式化时间
 */
export function formatTime(date: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

/**
 * 格式化日期时间
 */
export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

/**
 * 聊天日期分隔符格式化（今天/昨天/具体日期）
 */
export function formatChatDateDivider(isoString: string): string {
  if (!isoString) return ''
  const date = new Date(isoString)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  if (isSameDay(date, today)) {
    return 'Today'
  }
  if (isSameDay(date, yesterday)) {
    return 'Yesterday'
  }
  return formatDate(date)
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

// ============================================================================
// 数字格式化
// ============================================================================

/**
 * 俄语数字格式化（陶瓷行业常用）
 */
export function formatNumberRu(value: number, decimals = 2): string {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

/**
 * 面积格式化（平方米）
 */
export function formatM2(value: number): string {
  return `${formatNumberRu(value, 2)} м²`
}

/**
 * 金额格式化（俄语区域）
 */
export function formatCurrency(
  value: number,
  currency = 'UZS',
  locale = 'ru-RU'
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/**
 * 文件大小格式化
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

// ============================================================================
// 文本格式化
// ============================================================================

/**
 * 脱敏邮箱
 */
export function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return email
  const [name, domain] = email.split('@')
  if (name.length <= 2) return `${name[0]}***@${domain}`
  return `${name[0]}${'*'.repeat(name.length - 2)}${name[name.length - 1]}@${domain}`
}

/**
 * 脱敏手机号
 */
export function maskPhone(phone: string): string {
  if (!phone) return ''
  const cleaned = phone.replace(/\D/g, '')
  if (cleaned.length < 4) return '***'
  return `***${cleaned.slice(-4)}`
}

/**
 * 截断文本（带省略号）
 */
export function truncate(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 3)}...`
}

/**
 * 首字母大写
 */
export function capitalize(text: string): string {
  if (!text) return ''
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase()
}

/**
 * 姓名首字母大写
 */
export function capitalizeName(name: string | null | undefined): string {
  if (!name) return ''
  return name
    .split(' ')
    .map(capitalize)
    .join(' ')
}

// ============================================================================
// 导出常量
// ============================================================================

export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: 'Ожидает',
  audited: 'Проверено',
  accounted: 'Учтено',
  shipped: 'Отгружено',
  cancelled: 'Отменено',
}

export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  '1_public': 'Общественный',
  '2_cash': 'Наличный',
  '3_export': 'Экспорт',
}

export const USER_ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  checker: 'Проверяющий',
  warehouse: 'Склад',
  finance: 'Бухгалтер',
  customer: 'Клиент',
}
