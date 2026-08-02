<!--
  all-products/BulkImportDialog.vue
  Modal: 批量导入商品图册

  - 拖拽 / 选择 zip 文件
  - 进度条 (解压 -> 匹配 -> 上传)
  - 结果列表 (ok / unmatched / error)
  - 完成后刷新父页面 items
-->
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  X, Upload, FileArchive, CheckCircle2, AlertTriangle, Loader2,
  Package, RefreshCw, Download,
} from 'lucide-vue-next'
import Button from '@/components/ui/Button.vue'
import { useI18n } from '@/lib/i18n'
import {
  bulkUploadProductImages,
  type BulkProgress,
  type BulkResult,
} from '@/composables/useBulkProductImages'

const props = defineProps<{
  open: boolean
  modelToProductId: Map<string, string>
}>()
const emit = defineEmits<{
  'update:open': [v: boolean]
  done: [result: BulkResult]
}>()

const { t } = useI18n()

const fileInput = ref<HTMLInputElement | null>(null)
const dragOver = ref(false)
const zipFile = ref<File | null>(null)
const progress = ref<BulkProgress>({
  phase: 'idle',
  total: 0,
  done: 0,
  inFlight: [],
  error: null,
})
const result = ref<BulkResult | null>(null)
const running = computed(() =>
  progress.value.phase === 'parsing'
  || progress.value.phase === 'matching'
  || progress.value.phase === 'uploading',
)

const onClose = () => {
  if (running.value) return  // 进行中拒绝关闭
  emit('update:open', false)
}

const onPickFile = () => fileInput.value?.click()
const onFileChange = async (e: Event) => {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) await startWith(f)
  if (fileInput.value) fileInput.value.value = ''
}

const onDrop = async (e: DragEvent) => {
  e.preventDefault()
  dragOver.value = false
  const f = e.dataTransfer?.files?.[0]
  if (f) await startWith(f)
}

const startWith = async (f: File) => {
  if (!f.name.toLowerCase().endsWith('.zip')) {
    progress.value = { ...progress.value, error: '请选择 .zip 文件' }
    return
  }
  zipFile.value = f
  result.value = null
  progress.value = {
    phase: 'parsing',
    total: 0,
    done: 0,
    inFlight: [],
    error: null,
  }
  try {
    const r = await bulkUploadProductImages(f, props.modelToProductId, (p) => {
      progress.value = p
    })
    result.value = r
    emit('done', r)
  } catch (e: any) {
    progress.value = { ...progress.value, error: e?.message ?? String(e) }
  }
}

const reset = () => {
  zipFile.value = null
  result.value = null
  progress.value = {
    phase: 'idle',
    total: 0,
    done: 0,
    inFlight: [],
    error: null,
  }
}

watch(() => props.open, (v) => {
  if (!v) {
    // 关闭时清状态 (running 时由 onClose 拒绝, 不会走这里)
    reset()
  }
})

const percent = computed(() => {
  const p = progress.value
  if (p.phase === 'parsing') return 5
  if (p.phase === 'matching') return 15
  if (p.phase === 'uploading') {
    return p.total === 0 ? 15 : 15 + Math.round((p.done / p.total) * 80)
  }
  if (p.phase === 'done') return 100
  return 0
})

const fmtSize = (n: number) => {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const phaseLabel = computed(() => {
  switch (progress.value.phase) {
    case 'idle': return '选择 zip 包'
    case 'parsing': return '解压中…'
    case 'matching': return '匹配商品…'
    case 'uploading': {
      const p = progress.value
      return `上传中 (${p.done} / ${p.total})`
    }
    case 'done': return '完成'
  }
})

const downloadSample = () => {
  // 给一个简单的命名说明, 让用户知道 zip 内文件怎么命名
  const examples = props.modelToProductId.size > 0
    ? Array.from(props.modelToProductId.keys()).slice(0, 10)
    : ['A12P001', 'B15F002']
  const txt = `商品图批量导入说明

zip 包内容要求:
  1. 扁平结构 (不要嵌套子目录)
  2. 文件名 (不含扩展名) 必须 = 商品 model, 例如:
${examples.map((m) => `     ${m}.png`).join('\n')}
  3. 支持 png / jpg / jpeg / webp / gif
  4. 单个 zip 最多 200 张, 200 MB
  5. 未匹配的 model 会显示在结果里, 不会被上传

匹配规则: 文件名去扩展名后, 在 products.model 里查 product_id。
找不到的就是 "unmatched", 用户可自行排查后重传。
`
  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'README-商品图批量导入.txt'
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
       @click.self="onClose">
    <!-- 背景遮罩 -->
    <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="onClose" />

    <!-- 弹窗本体 -->
    <div class="relative w-full sm:max-w-2xl max-h-[90vh] bg-card rounded-t-2xl sm:rounded-2xl border shadow-2xl flex flex-col overflow-hidden">
      <!-- header -->
      <header class="px-5 py-4 border-b flex items-center gap-3 bg-muted/20">
        <div class="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Package class="h-4 w-4" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold leading-tight">批量导入商品图</p>
          <p class="text-[11px] text-muted-foreground leading-snug">
            上传 zip 包, 文件名 = 商品 model, 自动匹配 products 表
          </p>
        </div>
        <button type="button"
                class="h-7 w-7 rounded-md hover:bg-muted flex items-center justify-center shrink-0"
                :disabled="running"
                @click="onClose">
          <X class="h-4 w-4" />
        </button>
      </header>

      <!-- 进度条 -->
      <div v-if="running || progress.phase === 'done'" class="px-5 py-3 border-b bg-muted/5">
        <div class="flex items-center justify-between text-[11px] text-muted-foreground mb-1.5">
          <span class="font-medium">{{ phaseLabel }}</span>
          <span class="tabular-nums">{{ percent }}%</span>
        </div>
        <div class="h-1.5 rounded-full bg-muted overflow-hidden">
          <div class="h-full bg-primary transition-all duration-300" :style="{ width: percent + '%' }" />
        </div>
        <p v-if="progress.inFlight.length > 0" class="text-[10px] text-muted-foreground mt-1.5 truncate">
          <Loader2 class="inline h-3 w-3 animate-spin mr-0.5 -mt-0.5" />
          正在上传: {{ progress.inFlight.join(', ') }}
        </p>
      </div>

      <!-- 错误条 -->
      <div v-if="progress.error" class="px-5 py-3 border-b">
        <div class="flex items-start gap-2 border border-destructive/30 bg-destructive/5 text-destructive rounded-md p-2.5 text-xs">
          <AlertTriangle class="h-4 w-4 shrink-0 mt-0.5" />
          <span class="font-mono">{{ progress.error }}</span>
        </div>
      </div>

      <!-- 主区 -->
      <div class="flex-1 overflow-y-auto p-5 space-y-4">
        <!-- 上传区 -->
        <div v-if="!zipFile && !result"
             class="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition"
             :class="dragOver ? 'border-primary bg-primary/5' : 'border-border bg-muted/10 hover:bg-muted/20'"
             @click="onPickFile"
             @dragover.prevent="dragOver = true"
             @dragleave="dragOver = false"
             @drop="onDrop">
          <FileArchive class="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-60" />
          <p class="text-sm font-medium">点击选择 zip 包 或拖拽到此</p>
          <p class="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
            扁平结构, 文件名 = 商品 model<br>
            上限 200 张 / 200 MB, 支持 png/jpg/jpeg/webp/gif
          </p>
          <button type="button"
                  class="mt-3 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                  @click.stop="downloadSample">
            <Download class="h-3 w-3" />
            下载命名说明
          </button>
        </div>

        <!-- 已选文件 -->
        <div v-else-if="zipFile && !result" class="border rounded-xl p-4 flex items-center gap-3">
          <FileArchive class="h-8 w-8 text-primary shrink-0" />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium truncate">{{ zipFile.name }}</p>
            <p class="text-[11px] text-muted-foreground">{{ fmtSize(zipFile.size) }}</p>
          </div>
        </div>

        <!-- 结果 -->
        <div v-if="result" class="space-y-3">
          <!-- 汇总 chips -->
          <div class="grid grid-cols-3 gap-2">
            <div class="rounded-lg border bg-emerald-50 px-3 py-2">
              <p class="text-[10px] uppercase tracking-wider text-emerald-700">成功</p>
              <p class="text-xl font-bold tabular-nums mt-0.5 text-emerald-900">{{ result.ok }}</p>
            </div>
            <div class="rounded-lg border bg-amber-50 px-3 py-2">
              <p class="text-[10px] uppercase tracking-wider text-amber-700">未匹配</p>
              <p class="text-xl font-bold tabular-nums mt-0.5 text-amber-900">{{ result.unmatched }}</p>
            </div>
            <div class="rounded-lg border bg-rose-50 px-3 py-2">
              <p class="text-[10px] uppercase tracking-wider text-rose-700">失败</p>
              <p class="text-xl font-bold tabular-nums mt-0.5 text-rose-900">{{ result.error }}</p>
            </div>
          </div>

          <!-- 详细列表 -->
          <div class="border rounded-xl overflow-hidden">
            <div class="bg-muted/20 px-3 py-2 text-[11px] font-medium border-b flex items-center justify-between">
              <span>明细 ({{ result.files.length }})</span>
              <span class="text-muted-foreground text-[10px]">按状态分组</span>
            </div>
            <ul class="divide-y max-h-64 overflow-y-auto">
              <li v-for="f in result.files" :key="f.filename"
                  class="px-3 py-2 text-[11px] flex items-center gap-2">
                <span class="shrink-0">
                  <CheckCircle2 v-if="f.status === 'ok'" class="h-3.5 w-3.5 text-emerald-600" />
                  <AlertTriangle v-else-if="f.status === 'unmatched'" class="h-3.5 w-3.5 text-amber-600" />
                  <AlertTriangle v-else class="h-3.5 w-3.5 text-rose-600" />
                </span>
                <span class="font-mono truncate flex-1" :title="f.filename">{{ f.filename }}</span>
                <span v-if="f.status !== 'ok'" class="text-muted-foreground truncate max-w-[40%]" :title="f.message">
                  {{ f.message }}
                </span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <!-- footer -->
      <footer class="px-5 py-3 border-t bg-muted/10 flex items-center justify-end gap-2">
        <Button v-if="!result && !running" variant="outline" @click="onClose">取消</Button>
        <Button v-if="!result && zipFile && !running" variant="outline" @click="reset">
          <RefreshCw class="h-3.5 w-3.5 mr-1" />重选
        </Button>
        <Button v-if="result" variant="outline" @click="reset">
          再传一个
        </Button>
        <Button v-if="result" @click="onClose">
          <CheckCircle2 class="h-3.5 w-3.5 mr-1" />完成
        </Button>
      </footer>
    </div>
  </div>
</template>
