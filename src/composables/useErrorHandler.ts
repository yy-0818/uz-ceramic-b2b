/**
 * 统一错误处理工具
 *
 * 提供标准化的错误处理模式：
 * 1. 错误类型化
 * 2. 统一错误消息格式化
 * 3. 用户友好的错误提示
 */
import { ref, type Ref } from 'vue'

// 错误状态类型
export interface ErrorState {
  message: string | null
  code?: string
  details?: string
}

// 标准错误处理钩子
export function useErrorHandler() {
  const error = ref<string | null>(null)
  const isLoading = ref(false)

  const handleError = (e: unknown, fallbackMessage?: string): string => {
    let message: string

    if (e instanceof Error) {
      message = e.message
    } else if (typeof e === 'string') {
      message = e
    } else if (e && typeof e === 'object' && 'message' in e) {
      message = String((e as { message: unknown }).message)
    } else {
      message = fallbackMessage ?? 'An unexpected error occurred'
    }

    // 数据库特定错误处理
    if (typeof e === 'object' && e !== null && 'code' in e) {
      const dbError = e as { code: string; message?: string }
      switch (dbError.code) {
        case '23505':
          message = 'This record already exists (duplicate key)'
          break
        case '23503':
          message = 'Cannot delete: this record is referenced by other records'
          break
        case '23502':
          message = 'Required field is missing'
          break
        case 'PGRST204':
          message = 'Column not found in database'
          break
        default:
          if (!message && dbError.message) {
            message = dbError.message
          }
      }
    }

    error.value = message
    return message
  }

  const clearError = () => {
    error.value = null
  }

  const withErrorHandling = async <T>(
    fn: () => Promise<T>,
    options?: {
      errorMessage?: string
      onError?: (message: string) => void
      rethrow?: boolean
    }
  ): Promise<T | undefined> => {
    isLoading.value = true
    error.value = null

    try {
      const result = await fn()
      return result
    } catch (e: unknown) {
      const message = handleError(e, options?.errorMessage)
      options?.onError?.(message)

      if (options?.rethrow) {
        throw e
      }

      return undefined
    } finally {
      isLoading.value = false
    }
  }

  return {
    error,
    isLoading,
    handleError,
    clearError,
    withErrorHandling,
  }
}

// 格式化错误消息供用户显示
export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    // 用户友好的错误消息映射
    const message = error.message.toLowerCase()

    if (message.includes('network') || message.includes('fetch')) {
      return 'Network error. Please check your connection and try again.'
    }
    if (message.includes('timeout')) {
      return 'Request timed out. Please try again.'
    }
    if (message.includes('unauthorized') || message.includes('401')) {
      return 'Session expired. Please log in again.'
    }
    if (message.includes('forbidden') || message.includes('403')) {
      return 'You do not have permission to perform this action.'
    }
    if (message.includes('not found') || message.includes('404')) {
      return 'The requested resource was not found.'
    }
    if (message.includes('duplicate') || message.includes('23505')) {
      return 'This record already exists.'
    }

    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  return 'An unexpected error occurred. Please try again.'
}

// 创建异步操作的 loading/error 状态管理
export function useAsyncState<T>() {
  const data = ref<T | null>(null) as Ref<T | null>
  const error = ref<string | null>(null)
  const isLoading = ref(false)

  const execute = async (fn: () => Promise<T>) => {
    isLoading.value = true
    error.value = null

    try {
      data.value = await fn()
    } catch (e: unknown) {
      error.value = formatErrorMessage(e)
      data.value = null
    } finally {
      isLoading.value = false
    }
  }

  const reset = () => {
    data.value = null
    error.value = null
    isLoading.value = false
  }

  return {
    data,
    error,
    isLoading,
    execute,
    reset,
  }
}
