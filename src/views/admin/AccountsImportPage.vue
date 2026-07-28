<!--
  src/views/admin/AccountsImportPage.vue
  上传 客户档案库.xlsx → 解析 → 预览 → 一键生成 父 + 子 + 客户组映射
-->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { Upload, FileSpreadsheet, Loader2, AlertTriangle, CheckCircle2, X, ChevronRight, RefreshCw } from 'lucide-vue-next'
import { read, utils } from 'xlsx'
import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import CardContent from '@/components/ui/CardContent.vue'
import Badge from '@/components/ui/Badge.vue'
import { useAccounts, parseExcelRow, buildImportPreview, type ExcelRow, type ImportPreview } from '@/composables/useAccounts'

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
</script>

<template>
  <div class="space-y-4">
    <Card>
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <FileSpreadsheet class="h-5 w-5" />
          客户档案库导入
        </CardTitle>
      </CardHeader>
      <CardContent class="space-y-3">
        <div class="flex items-center gap-3 flex-wrap">
          <input
            ref="fileInput"
            type="file"
            accept=".xlsx,.xls,.csv"
            class="hidden"
            @change="onFileSelected"
          />
          <Button @click="handlePick" :disabled="phase === 'importing'">
            <Upload class="mr-2 h-4 w-4" />
            选择 Excel 文件
          </Button>
          <span v-if="fileName" class="text-sm text-muted-foreground truncate max-w-md">
            已选：{{ fileName }}
          </span>
          <Button variant="ghost" size="sm" v-if="phase !== 'idle'" @click="reset">
            <RefreshCw class="mr-1 h-3 w-3" />重置
          </Button>
        </div>

        <div v-if="errMsg" class="text-sm text-red-600 border border-red-200 bg-red-50 rounded-md p-3">
          {{ errMsg }}
        </div>
      </CardContent>
    </Card>

    <!-- 解析完成 · 预览 -->
    <Card v-if="preview && summary">
      <CardHeader>
        <CardTitle class="text-base flex items-center justify-between">
          <span>解析结果预览</span>
          <div class="flex gap-1 text-xs">
            <Badge variant="secondary">父账号: {{ summary.parents }}</Badge>
            <Badge variant="secondary">子账号: {{ summary.subs }}</Badge>
            <Badge variant="secondary">客户组: {{ summary.groups }}</Badge>
            <Badge v-if="summary.invalid > 0" class="bg-amber-100 text-amber-800">
              跳过: {{ summary.invalid }}
            </Badge>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <!-- 父账号预览 -->
        <div>
          <p class="text-xs font-medium text-muted-foreground mb-1">父账号预览（{{ preview.parents.length }} 个）</p>
          <div class="border rounded-md max-h-60 overflow-y-auto">
            <table class="w-full text-xs">
              <thead class="sticky top-0 bg-muted">
                <tr>
                  <th class="text-left px-2 py-1">类别</th>
                  <th class="text-left px-2 py-1">类型</th>
                  <th class="text-right px-2 py-1">子账号数</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="p in preview.parents" :key="p.category" class="border-t">
                  <td class="px-2 py-1 font-mono">{{ p.category }}</td>
                  <td class="px-2 py-1">{{ p.type }}</td>
                  <td class="px-2 py-1 text-right tabular-nums">{{ p.rowCount }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 子账号预览（前 20 条） -->
        <div>
          <p class="text-xs font-medium text-muted-foreground mb-1">子账号预览（前 20 条 / 共 {{ preview.subs.length }}）</p>
          <div class="border rounded-md max-h-60 overflow-y-auto">
            <table class="w-full text-xs">
              <thead class="sticky top-0 bg-muted">
                <tr>
                  <th class="text-left px-2 py-1">类别</th>
                  <th class="text-left px-2 py-1">客户名称</th>
                  <th class="text-left px-2 py-1">税号</th>
                  <th class="text-left px-2 py-1">类型</th>
                  <th class="text-left px-2 py-1">状态</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(s, i) in preview.subs.slice(0, 20)" :key="i" class="border-t">
                  <td class="px-2 py-1 font-mono">{{ s.category }}</td>
                  <td class="px-2 py-1 truncate max-w-[16rem]">{{ s.name }}</td>
                  <td class="px-2 py-1 font-mono">{{ s.inn || '-' }}</td>
                  <td class="px-2 py-1">{{ s.type }}</td>
                  <td class="px-2 py-1">
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
          <div class="flex items-center gap-1 text-amber-800 font-medium mb-1">
            <AlertTriangle class="h-3.5 w-3.5" />
            跳过的 {{ invalidRows.length }} 行（类别/客户名/类型不合法）
          </div>
          <ul class="list-disc list-inside space-y-0.5 text-amber-900">
            <li v-for="(inv, i) in invalidRows.slice(0, 5)" :key="i">
              {{ inv.reason }} — {{ JSON.stringify(inv.raw) }}
            </li>
            <li v-if="invalidRows.length > 5">...还有 {{ invalidRows.length - 5 }} 行</li>
          </ul>
        </div>

        <!-- 操作 -->
        <div v-if="phase !== 'done'" class="flex justify-end gap-2 pt-2">
          <Button variant="outline" @click="reset">取消</Button>
          <Button @click="runImport" :disabled="phase === 'importing' || preview.parents.length === 0">
            <Loader2 v-if="phase === 'importing'" class="mr-2 h-4 w-4 animate-spin" />
            <ChevronRight v-else class="mr-2 h-4 w-4" />
            {{ phase === 'importing' ? '导入中...' : `一键导入 ${summary.parents} 父 + ${summary.subs} 子` }}
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- 完成 -->
    <Card v-if="phase === 'done' && result">
      <CardContent class="text-center py-8 space-y-3">
        <CheckCircle2 class="h-12 w-12 text-emerald-600 mx-auto" />
        <p class="text-lg font-medium">导入完成</p>
        <div class="flex justify-center gap-2 text-sm flex-wrap">
          <Badge variant="secondary">父账号新增: {{ result.parentsAdded }}</Badge>
          <Badge variant="secondary">子账号新增: {{ result.subsAdded }}</Badge>
          <Badge v-if="result.subsUpdated > 0" class="bg-amber-100 text-amber-800">
            子账号更新: {{ result.subsUpdated }}
          </Badge>
          <Badge variant="secondary">客户组映射: {{ result.mappingsAdded }}</Badge>
        </div>
        <p class="text-xs text-muted-foreground">
          重复导入仅增量 + 同步状态变化（停用之类）；不覆盖账户名
        </p>
        <div class="flex justify-center gap-2 pt-2">
          <Button variant="outline" @click="router.push('/admin/accounts')">
            <ChevronRight class="mr-1 h-4 w-4" />前往账号管理
          </Button>
          <Button @click="reset">导入更多</Button>
        </div>
      </CardContent>
    </Card>
  </div>
</template>