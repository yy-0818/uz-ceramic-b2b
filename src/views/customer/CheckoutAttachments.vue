<!--
  CheckoutAttachments — 附件上传和备注
  - 图片上传区（拖拽 + 点击）
  - 图片预览 carousel
  - 文本备注输入
-->
<script setup lang="ts">
import { ref, computed } from 'vue'
import { ImagePlus, X, ChevronLeft, ChevronRight, AlertCircle } from 'lucide-vue-next'
import { useI18n } from '@/lib/i18n'
import { useOrderAttachments, isBrowserRenderable } from '@/composables/useOrderAttachments'
import Textarea from '@/components/ui/Textarea.vue'
import Label from '@/components/ui/Label.vue'
import Badge from '@/components/ui/Badge.vue'
import Loader2 from 'lucide-vue-next'

const props = defineProps<{
  attachments: ReturnType<typeof useOrderAttachments>
  parentAccountId: string | null
  remark: string
}>()

const emit = defineEmits<{
  'update:remark': [value: string]
  remark: string
}>()

const { t } = useI18n()

const MAX_ATTACHMENTS = 5

const attachmentError = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const activeIdx = ref(0)
const attCount = computed(() => props.attachments.items.value.length)

const canPrev = computed(() => attCount.value > 1)
const canNext = computed(() => attCount.value > 1)

const goPrev = () => {
  if (attCount.value < 2) return
  activeIdx.value = (activeIdx.value - 1 + attCount.value) % attCount.value
}

const goNext = () => {
  if (attCount.value < 2) return
  activeIdx.value = (activeIdx.value + 1) % attCount.value
}

const selectAtt = (i: number) => { activeIdx.value = i }

const onCarouselKey = (ev: KeyboardEvent) => {
  if (attCount.value < 2) return
  if (ev.key === 'ArrowLeft') { ev.preventDefault(); goPrev() }
  else if (ev.key === 'ArrowRight') { ev.preventDefault(); goNext() }
}

const onPickClick = () => {
  if (props.attachments.items.value.length >= MAX_ATTACHMENTS) {
    attachmentError.value = t('customer.checkout.attachmentsMaxReached')
    return
  }
  fileInput.value?.click()
}

const onFiles = (files: FileList | null) => {
  if (!files || files.length === 0) return
  attachmentError.value = null
  const accountId = props.parentAccountId
  if (!accountId) {
    attachmentError.value = '缺少主账号 id, 无法添加附件'
    return
  }
  const remaining = MAX_ATTACHMENTS - props.attachments.items.value.length
  const accepted = Array.from(files).slice(0, remaining)
  const warnHeic: string[] = []
  for (const file of accepted) {
    try {
      props.attachments.add(file, accountId)
      if (!isBrowserRenderable(file.type)) {
        warnHeic.push(file.name)
      }
    } catch (e: unknown) {
      attachmentError.value = e instanceof Error ? e.message : String(e)
    }
  }
  if (warnHeic.length > 0) {
    const msg = `以下图片浏览器无法本地预览 (但仍会上传): ${warnHeic.join(', ')}`
    attachmentError.value = attachmentError.value
      ? `${attachmentError.value}\n${msg}`
      : msg
  }
  if (fileInput.value) fileInput.value.value = ''
}

const onDrop = async (ev: DragEvent) => {
  ev.preventDefault()
  await onFiles(ev.dataTransfer?.files ?? null)
}

const onDragOver = (ev: DragEvent) => {
  ev.preventDefault()
}

const fmtSize = (n: number) => {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <section class="px-5 sm:px-6 py-5 border-b">
    <div class="flex items-center gap-2 mb-3">
      <span class="h-5 w-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center text-[10px] font-bold">
        3
      </span>
      <svg class="h-3.5 w-3.5 text-primary" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
      <h2 class="text-sm font-semibold text-foreground">附件与备注</h2>
      <Badge variant="secondary" class="ml-auto text-[10px] tabular-nums">
        {{ attachments.items.value.length }} / {{ MAX_ATTACHMENTS }}
      </Badge>
    </div>

    <!-- 上传区 -->
    <button
      type="button"
      class="w-full rounded-lg border-2 border-dashed transition p-4 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      :class="attachments.items.value.length >= MAX_ATTACHMENTS
        ? 'border-muted bg-muted/20 cursor-not-allowed opacity-60'
        : 'border-border/60 hover:border-primary/50 hover:bg-primary/5 cursor-pointer'"
      :disabled="attachments.items.value.length >= MAX_ATTACHMENTS"
      @click="onPickClick"
      @drop="onDrop"
      @dragover="onDragOver"
    >
      <div class="flex flex-col items-center gap-1.5 text-muted-foreground">
        <div class="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
          <ImagePlus class="h-4 w-4 text-primary" />
        </div>
        <p class="text-[11px] font-medium text-foreground">
          {{ t('customer.checkout.attachmentsEmpty') }}
        </p>
        <p class="text-[10px]">
          jpg / png / webp / heic · ≤ 5 MB · {{ MAX_ATTACHMENTS }} {{ t('customer.checkout.itemsCount') }}
        </p>
      </div>
    </button>
    <input
      ref="fileInput"
      type="file"
      accept="image/jpeg,image/png,image/webp,image/heic"
      multiple
      class="hidden"
      @change="onFiles(($event.target as HTMLInputElement).files)"
    />

    <!-- 错误提示 -->
    <div
      v-if="attachmentError"
      class="flex gap-2 border border-amber-200 bg-amber-50 text-amber-900 rounded-md p-2 text-[11px] mt-2"
    >
      <AlertCircle class="h-3.5 w-3.5 shrink-0 text-amber-600 mt-0.5" />
      <p>{{ attachmentError }}</p>
    </div>

    <!-- 已上传图片 carousel -->
    <div
      v-if="attachments.items.value.length > 0"
      class="space-y-2 mt-2"
      @keydown="onCarouselKey"
      tabindex="0"
      role="region"
      :aria-label="t('customer.checkout.attachmentsTitle')"
    >
      <!-- 大图区 -->
      <div class="relative rounded-lg border bg-card overflow-hidden shadow-sm">
        <div class="relative aspect-[4/3] sm:aspect-[16/10] bg-muted">
          <TransitionGroup name="att-fade" tag="div" class="absolute inset-0">
            <div
              v-for="(it, idx) in attachments.items.value"
              v-show="idx === activeIdx"
              :key="idx"
              class="absolute inset-0"
            >
              <img
                v-if="isBrowserRenderable(it.mime)"
                :src="it.local_url"
                :alt="it.caption ?? `attachment ${idx + 1}`"
                class="h-full w-full object-contain"
                loading="lazy"
              />
              <div
                v-else
                class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950/30 dark:to-amber-900/30"
              >
                <div class="h-12 w-12 rounded-full bg-amber-200/70 dark:bg-amber-800/50 flex items-center justify-center">
                  <ImagePlus class="h-6 w-6 text-amber-700 dark:text-amber-300" />
                </div>
                <div class="text-center px-4">
                  <p class="text-[12px] font-semibold text-amber-900 dark:text-amber-200">
                    {{ (it.mime || '').replace('image/', '').toUpperCase() || '未知格式' }}
                  </p>
                  <p class="text-[10px] text-amber-700/80 dark:text-amber-400/80 mt-0.5">
                    浏览器无法预览 · 提交时仍会上传
                  </p>
                </div>
              </div>
              <!-- 上传进度 overlay -->
              <div
                v-if="attachments.uploading.value && (it.progress ?? 0) < 100"
                class="absolute inset-0 bg-black/55 flex items-center justify-center backdrop-blur-[1px]"
              >
                <div class="text-white text-xs font-medium flex items-center gap-1.5">
                  <Loader2 class="h-3.5 w-3.5 animate-spin" />
                  {{ it.progress ?? 0 }}%
                </div>
              </div>
              <div
                v-if="it.error"
                class="absolute inset-0 bg-destructive/85 flex items-center justify-center p-3"
              >
                <p class="text-white text-[11px] text-center leading-tight">
                  {{ it.error }}
                </p>
              </div>
            </div>
          </TransitionGroup>
          <button
            type="button"
            class="absolute top-1.5 right-1.5 h-7 w-7 rounded-full bg-black/70 hover:bg-destructive text-white flex items-center justify-center transition shadow-md"
            :title="t('customer.checkout.attachmentsRemove')"
            @click="attachments.remove(activeIdx)"
          >
            <X class="h-3.5 w-3.5" />
          </button>
          <template v-if="attachments.items.value.length > 1">
            <button
              type="button"
              class="absolute top-1/2 left-1.5 -translate-y-1/2 h-7 w-7 rounded-full bg-black/60 hover:bg-black/85 text-white flex items-center justify-center transition shadow-md backdrop-blur"
              :aria-label="t('customer.checkout.attachmentsPrev')"
              @click="goPrev"
            >
              <ChevronLeft class="h-4 w-4" />
            </button>
            <button
              type="button"
              class="absolute top-1/2 right-1.5 -translate-y-1/2 h-7 w-7 rounded-full bg-black/60 hover:bg-black/85 text-white flex items-center justify-center transition shadow-md backdrop-blur"
              :aria-label="t('customer.checkout.attachmentsNext')"
              @click="goNext"
            >
              <ChevronRight class="h-4 w-4" />
            </button>
            <span class="absolute bottom-1.5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-black/70 text-white text-[10px] font-medium tabular-nums backdrop-blur">
              {{ activeIdx + 1 }} / {{ attachments.items.value.length }}
            </span>
          </template>
        </div>
        <div class="px-2.5 py-1.5 border-t bg-muted/30 flex items-center justify-between gap-2">
          <p class="text-[10px] text-muted-foreground truncate font-mono tabular-nums">
            {{
              (attachments.items.value[activeIdx]?.mime ?? '')
                .replace('image/', '')
                .toUpperCase()
            }}
            ·
            {{ fmtSize(attachments.items.value[activeIdx]?.size_bytes ?? 0) }}
          </p>
          <p
            v-if="attachments.items.value[activeIdx]?.error"
            class="text-[10px] text-destructive truncate"
          >
            {{ attachments.items.value[activeIdx]?.error }}
          </p>
        </div>
      </div>

      <!-- Thumbnail 横排 -->
      <ul class="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 snap-x">
        <li
          v-for="(it, idx) in attachments.items.value"
          :key="idx"
          class="shrink-0 snap-start"
        >
          <button
            type="button"
            class="relative h-16 w-16 sm:h-20 sm:w-20 rounded-md overflow-hidden border-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            :class="idx === activeIdx
              ? 'border-primary shadow-md shadow-primary/20 ring-2 ring-primary/30'
              : 'border-border/60 hover:border-primary/50 opacity-70 hover:opacity-100'"
            :title="`#${idx + 1}`"
            @click="selectAtt(idx)"
          >
            <img
              :src="it.local_url"
              :alt="`thumbnail ${idx + 1}`"
              class="h-full w-full object-cover"
              loading="lazy"
            />
            <span
              v-if="!isBrowserRenderable(it.mime)"
              class="absolute inset-0 bg-amber-500/85 flex items-center justify-center p-1"
              title="浏览器无法本地预览此格式 (提交时仍会上传)"
            >
              <span class="text-white text-[9px] font-bold text-center leading-tight">
                浏览器无法预览
              </span>
            </span>
            <span
              v-if="it.error"
              class="absolute inset-0 bg-destructive/70 flex items-center justify-center"
            >
              <AlertCircle class="h-3.5 w-3.5 text-white" />
            </span>
            <span
              class="absolute top-0.5 left-0.5 h-4 min-w-4 px-1 rounded-full bg-black/70 text-white text-[9px] font-bold tabular-nums flex items-center justify-center"
            >
              {{ idx + 1 }}
            </span>
          </button>
        </li>
      </ul>
    </div>

    <!-- 文本备注 -->
    <div class="mt-4 pt-4 border-t border-dashed">
      <div class="flex items-center gap-2 mb-2">
        <svg class="h-3.5 w-3.5 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <Label for="remark" class="text-xs font-medium text-muted-foreground">
          {{ t('customer.checkout.remark') }}
        </Label>
        <span
          v-if="remark.length > 0"
          class="ml-auto text-[10px] text-muted-foreground tabular-nums"
        >
          {{ remark.length }}
        </span>
      </div>
      <Textarea
        id="remark"
        :model-value="remark"
        :placeholder="t('customer.checkout.remarkPh')"
        class="min-h-20 resize-none text-sm bg-background"
        @update:model-value="emit('update:remark', $event)"
      />
    </div>
  </section>
</template>

<style scoped>
.att-fade-enter-active,
.att-fade-leave-active {
  transition: opacity 0.18s ease;
}
.att-fade-enter-from,
.att-fade-leave-to {
  opacity: 0;
}
[role='region']:focus-visible {
  outline: none;
}
[role='region']:focus-visible > :first-child {
  box-shadow: 0 0 0 2px var(--ring, hsl(var(--primary)));
}
</style>
