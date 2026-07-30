<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { Upload, FileSpreadsheet, Loader2, AlertTriangle, CheckCircle2, ChevronRight, RefreshCw, ArrowLeft } from 'lucide-vue-next'
import { read, utils } from 'xlsx'
import { useI18n } from '@/lib/i18n'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import Badge from '@/components/ui/Badge.vue'
import { useAccounts, parseExcelRow, buildImportPreview, type ExcelRow, type ImportPreview } from '@/composables/useAccounts'

const { t } = useI18n()
const router = useRouter()
const accounts = useAccounts()

const fileInput = ref<HTMLInputElement | null>(null)
const rawRows = ref<ExcelRow[]>([])
const invalidRows = ref<Array<{ raw: any; reason: string }>>([])
const preview = ref<ImportPreview | null>(null)
const fileName = ref<string>('')
const phase = ref<'idle' | 'parsed' | 'importing' | 'done'>('idle')
const result = ref<{ parentsAdded: number; subsAdded: number; subsUpdated: number; mappingsAdded: number } | null>(null)
const errMsg = ref<string | null>(null)

const handlePick = () => fileInput.value?.click()

const onBack = () => {
  if (window.history.state && (window.history.state as any).back) {
    router.back()
  } else {
    router.push('/admin/accounts')
  }
}

const onFileSelected = async (e: Event) => {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  errMsg.value = null
  fileName.value = f.name
  phase.value = 'parsed'
  try {
    const buf = await f.arrayBuffer()
    const wb = read(buf, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const data = utils.sheet_to_json<any>(ws, { defval: '' })
    const valid: ExcelRow[] = []
    const invalid: Array<{ raw: any; reason: string }> = []
    for (const raw of data) {
      const row = parseExcelRow(raw)
      if (row) valid.push(row)
      else invalid.push({ raw, reason: !raw['类别'] ? '类别为空' : !raw['客户名称'] ? '客户名称为空' : '账户类型不识别' })
    }
    rawRows.value = valid
    invalidRows.value = invalid
    preview.value = buildImportPreview(valid)
  } catch (e: any) {
    errMsg.value = `解析失败：${e.message ?? String(e)}`
    phase.value = 'idle'
  } finally {
    if (fileInput.value) fileInput.value.value = ''
  }
}

const summary = computed(() => {
  if (!preview.value) return null
  return {
    parents: preview.value.parents.length,
    subs: preview.value.subs.length,
    groups: preview.value.groupMappings.length,
    invalid: invalidRows.value.length,
  }
})

const runImport = async () => {
  if (!preview.value) return
  phase.value = 'importing'
  errMsg.value = null
  try {
    const r = await accounts.importFromExcel(preview.value)
    result.value = r
    phase.value = 'done'
  } catch (e: any) {
    errMsg.value = e.message ?? String(e)
    phase.value = 'parsed'
  }
}

const reset = () => {
  phase.value = 'idle'
  preview.value = null
  rawRows.value = []
  invalidRows.value = []
  result.value = null
  errMsg.value = null
  fileName.value = ''
}

/* ---------------- step 视觉辅助 ---------------- */
// 步骤完成判定：phase 推进时，更早的 step 自动完成
const stepDone = (n: number) => {
  if (phase.value === 'idle') return false
  if (phase.value === 'parsed') return n === 1
  if (phase.value === 'importing') return n === 1 || n === 2
  // done
  return true
}

const stepStateClass = (n: number) => {
  if (stepDone(n)) return 'text-emerald-700'
  if (phase.value === 'idle') return n === 1 ? 'text-foreground' : 'text-muted-foreground'
  // 解析之后：当前活跃 step（最新未完成的）
  if (phase.value === 'parsed') return n === 2 ? 'text-foreground' : 'text-muted-foreground'
  if (phase.value === 'importing') return n === 3 ? 'text-foreground' : 'text-muted-foreground'
  return 'text-muted-foreground'
}

const stepCircleClass = (n: number) => {
  if (stepDone(n)) return 'bg-emerald-100 text-emerald-700'
  if (
    (phase.value === 'idle' && n === 1) ||
    (phase.value === 'parsed' && n === 2) ||
    (phase.value === 'importing' && n === 3)
  ) return 'bg-primary text-primary-foreground shadow-sm shadow-primary/30'
  return 'border bg-background text-muted-foreground'
}

const stepLineClass = (n: number) => {
  // 连线在 n 步骤完成时变实色
  return stepDone(n) ? 'bg-emerald-300' : 'bg-border'
}

const phaseLabel = computed(() => {
  switch (phase.value) {
    case 'idle': return '第一步：上传客户档案库 Excel 文件'
    case 'parsed': return '第二步：核对解析结果，确认后一键导入'
    case 'importing': return '第三步：正在写入数据库（请勿关闭页面）'
    case 'done': return '第四步：导入完成，可前往账号管理查看'
  }
})
</script>
<template>
  <!--
    整体布局：
      1. 顶部 hero：返回 + 标题 + 4 步骤指示条（上传 → 预览 → 导入 → 完成）
      2. 主区：单一卡片，按步骤分 section；
         section header 用同一个编号 + icon 模板，状态/进度一目了然。

    视觉语言：与 CheckoutPage 保持一致（hero 渐变 + 单一卡片 + section 编号），
    让"代客下单"和"导入账号"在视觉上是同一类"分步操作"页面。
  -->

  <!-- ===================== 顶部 hero ===================== -->
  <header class="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/[0.04] via-background to-background px-4 sm:px-6 py-4 sm:py-5 mb-4">
    <div class="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-primary/10 blur-2xl" />
    <div class="pointer-events-none absolute -right-4 top-1/2 h-24 w-24 rounded-full bg-primary/5" />

    <div class="relative flex items-start gap-2">
      <Button size="icon" variant="ghost" class="h-8 w-8 shrink-0 -ml-1" @click="onBack">
        <ArrowLeft class="h-4 w-4" />
      </Button>
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline gap-2 flex-wrap">
          <h1 class="text-base sm:text-lg font-bold leading-tight">
            客户档案库导入
          </h1>
          <span class="text-[10px] font-semibold tracking-wider text-primary uppercase">
            Excel · 批量
          </span>
        </div>
        <p class="text-xs text-muted-foreground mt-0.5 leading-snug max-w-xl">
          上传一份 <span class="font-mono">客户档案库.xlsx</span>，
          系统会自动解析、预览、生成父账号与子账号。重复导入仅增量同步状态。
        </p>
      </div>
    </div>

    <!-- 步骤指示条：上传 → 预览 → 导入 → 完成 -->
    <ol class="relative mt-4 grid grid-cols-4 sm:grid-cols-[auto_1fr_auto_1fr_auto_1fr_auto_1fr_auto] items-center gap-1.5 sm:gap-2 text-[11px]">
      <li class="flex items-center gap-1.5" :class="stepStateClass(1)">
        <span class="h-5 w-5 rounded-full flex items-center justify-center"
              :class="stepCircleClass(1)">
          <CheckCircle2 v-if="stepDone(1)" class="h-3 w-3" />
          <Upload v-else class="h-3 w-3" />
        </span>
        <span class="font-medium hidden sm:inline">上传</span>
      </li>
      <li class="hidden sm:block"><span class="block h-px" :class="stepLineClass(1)" /></li>
      <li class="flex items-center gap-1.5" :class="stepStateClass(2)">
        <span class="h-5 w-5 rounded-full flex items-center justify-center"
              :class="stepCircleClass(2)">
          <CheckCircle2 v-if="stepDone(2)" class="h-3 w-3" />
          <span v-else class="text-[10px] font-bold">2</span>
        </span>
        <span class="font-medium hidden sm:inline">预览</span>
      </li>
      <li class="hidden sm:block"><span class="block h-px" :class="stepLineClass(2)" /></li>
      <li class="flex items-center gap-1.5" :class="stepStateClass(3)">
        <span class="h-5 w-5 rounded-full flex items-center justify-center"
              :class="stepCircleClass(3)">
          <CheckCircle2 v-if="stepDone(3)" class="h-3 w-3" />
          <span v-else class="text-[10px] font-bold">3</span>
        </span>
        <span class="font-medium hidden sm:inline">导入</span>
      </li>
      <li class="hidden sm:block"><span class="block h-px" :class="stepLineClass(3)" /></li>
      <li class="flex items-center gap-1.5" :class="stepStateClass(4)">
        <span class="h-5 w-5 rounded-full flex items-center justify-center"
              :class="stepCircleClass(4)">
          <CheckCircle2 v-if="stepDone(4)" class="h-3 w-3" />
          <span v-else class="text-[10px] font-bold">4</span>
        </span>
        <span class="font-medium hidden sm:inline">完成</span>
      </li>
    </ol>
  </header>

  <!-- ===================== 主区：单一卡片 ===================== -->
  <Card class="overflow-hidden">
    <CardContent class="p-0">
      <!-- 顶部：表单标题 + 当前状态 -->
      <div class="px-5 sm:px-6 py-4 border-b bg-muted/20 flex items-center gap-3">
        <div class="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <FileSpreadsheet class="h-4 w-4 text-primary" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold leading-tight">导入工作流</p>
          <p class="text-[11px] text-muted-foreground leading-snug">
            {{ phaseLabel }}
          </p>
        </div>
        <Badge v-if="summary" variant="secondary" class="text-[10px] tabular-nums">
          {{ summary.parents }} 父 · {{ summary.subs }} 子
        </Badge>
      </div>

      <!-- ============ Section 1：上传文件 ============ -->
      <section class="px-5 sm:px-6 py-5 border-b">
        <div class="flex items-center gap-2 mb-3">
          <span class="h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                :class="stepDone(1) ? 'bg-emerald-100 text-emerald-700' : (phase === 'idle' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')">
            <CheckCircle2 v-if="stepDone(1)" class="h-3 w-3" />
            <Upload v-else class="h-3 w-3" />
          </span>
          <FileSpreadsheet class="h-3.5 w-3.5 text-primary" />
          <h2 class="text-sm font-semibold text-foreground">选择 Excel 文件</h2>
          <span class="text-[10px] text-muted-foreground ml-0.5">
            .xlsx / .xls / .csv
          </span>
          <Button
            v-if="phase !== 'idle'"
            variant="ghost"
            size="sm"
            class="ml-auto h-7 px-2 text-xs"
            @click="reset"
          >
            <RefreshCw class="mr-1 h-3 w-3" />
            重置
          </Button>
        </div>

        <input
          ref="fileInput"
          type="file"
          accept=".xlsx,.xls,.csv"
          class="hidden"
          @change="onFileSelected"
        />

        <!-- 上传区：未选 / 已选两种态 -->
        <button
          type="button"
          class="w-full rounded-lg border-2 border-dashed transition p-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          :class="phase === 'importing'
            ? 'border-muted bg-muted/20 cursor-not-allowed opacity-60'
            : fileName
              ? 'border-primary/40 bg-primary/5 hover:bg-primary/10'
              : 'border-border/60 hover:border-primary/50 hover:bg-primary/5 cursor-pointer'"
          :disabled="phase === 'importing'"
          @click="handlePick"
        >
          <div v-if="!fileName" class="flex flex-col items-center gap-1.5 text-muted-foreground py-2">
            <div class="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Upload class="h-5 w-5 text-primary" />
            </div>
            <p class="text-sm font-medium text-foreground">点击选择 Excel 文件</p>
            <p class="text-[11px]">支持 .xlsx / .xls / .csv，单文件</p>
          </div>
          <div v-else class="flex items-center gap-3">
            <div class="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <FileSpreadsheet class="h-5 w-5 text-primary" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium truncate">{{ fileName }}</p>
              <p class="text-[11px] text-muted-foreground">
                点击重新选择其他文件
              </p>
            </div>
          </div>
        </button>

        <!-- 错误提示 -->
        <div
          v-if="errMsg"
          class="flex gap-2 border border-destructive/30 bg-destructive/5 text-destructive rounded-md p-2.5 text-xs mt-3"
        >
          <AlertTriangle class="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <p class="leading-relaxed">{{ errMsg }}</p>
        </div>
      </section>

      <!-- ============ Section 2：解析预览 ============ -->
      <section v-if="preview && summary" class="px-5 sm:px-6 py-5 border-b">
        <div class="flex items-center gap-2 mb-3">
          <span class="h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold"
                :class="stepDone(2) ? 'bg-emerald-100 text-emerald-700' : 'bg-primary text-primary-foreground'">
            <CheckCircle2 v-if="stepDone(2)" class="h-3 w-3" />
            <span v-else class="text-[10px] font-bold">2</span>
          </span>
          <h2 class="text-sm font-semibold text-foreground">解析预览</h2>
          <span class="text-[11px] text-muted-foreground">
            确认无误后可一键导入
          </span>
        </div>

        <!-- 摘要 chips -->
        <div class="flex flex-wrap gap-1.5 mb-4">
          <Badge variant="secondary" class="text-[10px]">
            父账号 {{ summary.parents }}
          </Badge>
          <Badge variant="secondary" class="text-[10px]">
            子账号 {{ summary.subs }}
          </Badge>
          <Badge variant="secondary" class="text-[10px]">
            客户组映射 {{ summary.groups }}
          </Badge>
          <Badge v-if="summary.invalid > 0" class="bg-amber-100 text-amber-800 border-amber-200 text-[10px]">
            <AlertTriangle class="h-3 w-3 mr-0.5" />
            跳过 {{ summary.invalid }} 行
          </Badge>
        </div>

        <!-- 父账号预览 -->
        <div class="mb-4">
          <p class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
            父账号预览（{{ preview.parents.length }} 个）
          </p>
          <div class="border rounded-md max-h-56 overflow-y-auto">
            <table class="w-full text-xs">
              <thead class="sticky top-0 bg-muted/60 backdrop-blur">
                <tr>
                  <th class="text-left px-3 py-1.5 font-medium text-muted-foreground">类别</th>
                  <th class="text-left px-3 py-1.5 font-medium text-muted-foreground">类型</th>
                  <th class="text-right px-3 py-1.5 font-medium text-muted-foreground">
                    {{ t('admin.productsAll.import.colSubs') }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in preview.parents" :key="p.category" class="border-t hover:bg-muted/30 transition">
                  <td class="px-3 py-1.5 font-mono font-medium">{{ p.category }}</td>
                  <td class="px-3 py-1.5 text-muted-foreground">{{ p.type }}</td>
                  <td class="px-3 py-1.5 text-right tabular-nums font-mono">{{ p.rowCount }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 子账号预览 -->
        <div class="mb-4">
          <p class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
            子账号预览（前 20 条 / 共 {{ preview.subs.length }}）
          </p>
          <div class="border rounded-md max-h-60 overflow-y-auto">
            <table class="w-full text-xs">
              <thead class="sticky top-0 bg-muted/60 backdrop-blur">
                <tr>
                  <th class="text-left px-3 py-1.5 font-medium text-muted-foreground">类别</th>
                  <th class="text-left px-3 py-1.5 font-medium text-muted-foreground">客户名称</th>
                  <th class="text-left px-3 py-1.5 font-medium text-muted-foreground">税号</th>
                  <th class="text-left px-3 py-1.5 font-medium text-muted-foreground">类型</th>
                  <th class="text-left px-3 py-1.5 font-medium text-muted-foreground">状态</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(s, i) in preview.subs.slice(0, 20)" :key="i" class="border-t hover:bg-muted/30 transition">
                  <td class="px-3 py-1.5 font-mono">{{ s.category }}</td>
                  <td class="px-3 py-1.5 truncate max-w-[16rem]">{{ s.name }}</td>
                  <td class="px-3 py-1.5 font-mono text-muted-foreground">{{ s.inn || '-' }}</td>
                  <td class="px-3 py-1.5 text-muted-foreground">{{ s.type }}</td>
                  <td class="px-3 py-1.5">
                    <Badge :variant="s.status === 'active' ? 'secondary' : 'outline'" class="text-[10px]">
                      {{ s.status === 'active' ? '可用' : '停用' }}
                    </Badge>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 跳过的行 -->
        <div v-if="invalidRows.length > 0" class="border border-amber-200 bg-amber-50 rounded-md p-3 text-xs">
          <div class="flex items-center gap-1 text-amber-800 font-semibold mb-1.5">
            <AlertTriangle class="h-3.5 w-3.5" />
            跳过的 {{ invalidRows.length }} 行（类别 / 客户名 / 类型不合法）
          </div>
          <ul class="list-disc list-inside space-y-0.5 text-amber-900 leading-relaxed">
            <li v-for="(inv, i) in invalidRows.slice(0, 5)" :key="i">
              {{ inv.reason }} — <span class="font-mono">{{ JSON.stringify(inv.raw) }}</span>
            </li>
            <li v-if="invalidRows.length > 5" class="text-amber-700">
              ... 还有 {{ invalidRows.length - 5 }} 行
            </li>
          </ul>
        </div>

        <!-- 操作：导入按钮 -->
        <div v-if="phase !== 'done'" class="flex justify-end gap-2 pt-4 mt-4 border-t">
          <Button variant="outline" @click="reset" :disabled="phase === 'importing'">
            取消
          </Button>
          <Button
            @click="runImport"
            :disabled="phase === 'importing' || preview.parents.length === 0"
            class="shadow-md shadow-primary/20"
          >
            <Loader2 v-if="phase === 'importing'" class="mr-2 h-4 w-4 animate-spin" />
            <ChevronRight v-else class="mr-1 h-4 w-4" />
            {{
              phase === 'importing'
                ? '导入中...'
                : `一键导入 ${summary.parents} 父 + ${summary.subs} 子`
            }}
          </Button>
        </div>
      </section>

      <!-- ============ Section 3：完成 ============ -->
      <section v-if="phase === 'done' && result" class="px-5 sm:px-6 py-6">
        <div class="flex items-center gap-2 mb-4">
          <span class="h-5 w-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
            <CheckCircle2 class="h-3 w-3" />
          </span>
          <h2 class="text-sm font-semibold text-foreground">导入完成</h2>
        </div>

        <div class="rounded-lg border bg-gradient-to-br from-emerald-50 to-background p-5 text-center space-y-3">
          <div class="mx-auto h-14 w-14 rounded-full bg-emerald-100 flex items-center justify-center">
            <CheckCircle2 class="h-7 w-7 text-emerald-600" />
          </div>
          <div>
            <p class="text-base font-semibold">已成功导入</p>
            <p class="text-xs text-muted-foreground mt-0.5">
              重复导入仅增量 + 同步状态变化（停用之类）；不覆盖账户名
            </p>
          </div>
          <div class="flex justify-center gap-2 text-sm flex-wrap">
            <div class="rounded-md border bg-card px-3 py-2 min-w-[100px]">
              <p class="text-[10px] uppercase tracking-wider text-muted-foreground">父账号新增</p>
              <p class="text-lg font-bold tabular-nums mt-0.5">{{ result.parentsAdded }}</p>
            </div>
            <div class="rounded-md border bg-card px-3 py-2 min-w-[100px]">
              <p class="text-[10px] uppercase tracking-wider text-muted-foreground">子账号新增</p>
              <p class="text-lg font-bold tabular-nums mt-0.5">{{ result.subsAdded }}</p>
            </div>
            <div v-if="result.subsUpdated > 0" class="rounded-md border bg-amber-50 border-amber-200 px-3 py-2 min-w-[100px]">
              <p class="text-[10px] uppercase tracking-wider text-amber-700">子账号更新</p>
              <p class="text-lg font-bold tabular-nums mt-0.5 text-amber-900">{{ result.subsUpdated }}</p>
            </div>
            <div class="rounded-md border bg-card px-3 py-2 min-w-[100px]">
              <p class="text-[10px] uppercase tracking-wider text-muted-foreground">客户组映射</p>
              <p class="text-lg font-bold tabular-nums mt-0.5">{{ result.mappingsAdded }}</p>
            </div>
          </div>
          <div class="flex justify-center gap-2 pt-2">
            <Button variant="outline" @click="reset">
              <RefreshCw class="mr-1.5 h-3.5 w-3.5" />
              导入更多
            </Button>
            <Button @click="router.push('/admin/accounts')" class="shadow-md shadow-primary/20">
              <ChevronRight class="mr-1 h-4 w-4" />
              前往账号管理
            </Button>
          </div>
        </div>
      </section>
    </CardContent>
  </Card>
</template>
