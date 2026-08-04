/**
 * 标准化加载状态管理
 * 统一组件和 composables 的加载状态处理
 */
import { ref, computed, type Ref, type ComputedRef } from 'vue'

export interface LoadingState {
  isLoading: Ref<boolean>
  isIdle: ComputedRef<boolean>
  start: () => void
  stop: () => void
  run: <T>(fn: () => Promise<T>) => Promise<T>
}

/**
 * 创建标准化加载状态
 */
export function useLoadingState(): LoadingState {
  const isLoading = ref(false)

  const isIdle = computed(() => !isLoading.value)

  const start = () => {
    isLoading.value = true
  }

  const stop = () => {
    isLoading.value = false
  }

  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    start()
    try {
      return await fn()
    } finally {
      stop()
    }
  }

  return {
    isLoading,
    isIdle,
    start,
    stop,
    run,
  }
}

/**
 * 多操作加载状态管理
 */
export interface MultiLoadingState {
  // 状态
  activeCount: Ref<number>
  isLoading: ComputedRef<boolean>
  isIdle: ComputedRef<boolean>

  // 操作
  start: () => void
  stop: () => void
  run: <T>(fn: () => Promise<T>) => Promise<T>
  reset: () => void
}

/**
 * 创建多操作加载状态（支持多个并发操作）
 */
export function useMultiLoadingState(): MultiLoadingState {
  const activeCount = ref(0)

  const isLoading = computed(() => activeCount.value > 0)
  const isIdle = computed(() => activeCount.value === 0)

  let startCalled = 0
  let stopCalled = 0

  const start = () => {
    activeCount.value++
    startCalled++
  }

  const stop = () => {
    if (activeCount.value > 0) {
      activeCount.value--
    }
    stopCalled++
  }

  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    start()
    try {
      return await fn()
    } finally {
      stop()
    }
  }

  const reset = () => {
    activeCount.value = 0
    startCalled = 0
    stopCalled = 0
  }

  return {
    activeCount,
    isLoading,
    isIdle,
    start,
    stop,
    run,
    reset,
  }
}

/**
 * 分页加载状态
 */
export interface PaginatedLoadingState<T> {
  // 状态
  items: Ref<T[]>
  isLoading: Ref<boolean>
  isLoadingMore: Ref<boolean>
  hasMore: Ref<boolean>
  error: Ref<string | null>

  // 操作
  load: () => Promise<void>
  loadMore: () => Promise<void>
  refresh: () => Promise<void>
  reset: () => void
}

export interface PaginationOptions {
  pageSize?: number
  initialPage?: number
}

export function usePaginatedState<T>(
  fetchFn: (page: number, pageSize: number) => Promise<{ items: T[]; hasMore: boolean }>,
  options: PaginationOptions = {}
): PaginatedLoadingState<T> {
  const pageSize = options.pageSize ?? 20
  const initialPage = options.initialPage ?? 1

  const items = ref<T[]>([]) as Ref<T[]>
  const currentPage = ref(initialPage)
  const isLoading = ref(false)
  const isLoadingMore = ref(false)
  const hasMore = ref(true)
  const error = ref<string | null>(null)

  const load = async () => {
    if (isLoading.value) return

    isLoading.value = true
    error.value = null
    currentPage.value = initialPage

    try {
      const result = await fetchFn(currentPage.value, pageSize)
      items.value = result.items
      hasMore.value = result.hasMore
      currentPage.value++
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load'
      items.value = []
      hasMore.value = false
    } finally {
      isLoading.value = false
    }
  }

  const loadMore = async () => {
    if (isLoadingMore.value || !hasMore.value) return

    isLoadingMore.value = true
    error.value = null

    try {
      const result = await fetchFn(currentPage.value, pageSize)
      items.value = [...items.value, ...result.items]
      hasMore.value = result.hasMore
      currentPage.value++
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load more'
    } finally {
      isLoadingMore.value = false
    }
  }

  const refresh = async () => {
    currentPage.value = initialPage
    hasMore.value = true
    await load()
  }

  const reset = () => {
    items.value = []
    currentPage.value = initialPage
    isLoading.value = false
    isLoadingMore.value = false
    hasMore.value = true
    error.value = null
  }

  return {
    items,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    load,
    loadMore,
    refresh,
    reset,
  }
}
