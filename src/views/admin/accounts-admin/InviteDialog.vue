<!--
  src/views/admin/accounts-admin/InviteDialog.vue
  邀请链接对话框 —— Tab 切换：发链接 / 历史记录
  - 父级持有业务结果：inviteResult (发链接成功后的 url/loginEmail/expiresAt/token)
  - 父级持有 invMgr (useCustomerInvites) 实例，通过 prop 传入
  - 父级调 createInvite → 把结果写回 :invite-result；切到 history 时父级调 invMgr.fetchForAccount(target.id)
  - dialog 内只做模板渲染、tab 切换、多语言模板拼装、复制操作
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Copy, Loader2, Mail, RefreshCw, X } from 'lucide-vue-next'

import Button from '@/components/ui/Button.vue'
import Input from '@/components/ui/Input.vue'
import Label from '@/components/ui/Label.vue'
import Dialog from '@/components/ui/Dialog.vue'
import AccountRowSkeleton from '@/components/ui/AccountRowSkeleton.vue'

import { useI18n } from '@/lib/i18n'
import type { Locale } from '@/lib/i18n'
import type { Account } from '@/composables/useAccounts'

type InviteResult = {
  url: string
  loginEmail: string
  expiresAt: string
  token: string
}

const props = defineProps<{
  open: boolean
  target: Account | null
  invMgr: ReturnType<typeof import('@/composables/useCustomerInvites').useCustomerInvites>
  inviteResult: InviteResult | null
  loading: boolean             // 发链接中的 loading（父级持有）
}>()

const emit = defineEmits<{
  (e: 'update:open', v: boolean): void
  (e: 'generate'): void        // 父级调 createInvite() → 把结果写回 :invite-result
  (e: 'fetch-history'): void   // 切到 history Tab 时由父级拉取
  (e: 'revoke', inviteId: string): void   // 父级调 invMgr.revokeInvite()
}>()

const { t, locale, tForLocale } = useI18n()

type TabKey = 'send' | 'history'
const inviteTab = ref<TabKey>('send')
watch(() => props.open, (v) => { if (v) inviteTab.value = 'send' })

const inviteTabs = computed((): { key: TabKey; label: string }[] => [
  { key: 'send',    label: t('admin.invites.tabSend') },
  { key: 'history', label: t('admin.invites.tabHistory') },
])

const switchTab = async (key: TabKey) => {
  inviteTab.value = key
  if (key === 'history') emit('fetch-history')
}

// 多语言模板（dialog 内做拼装，不污染父级）
const inviteTplLang = ref<'ru' | 'uz' | 'zh'>('ru')
const tplLangs = [
  { code: 'ru', label: 'Русский' },
  { code: 'uz', label: 'Oʻzbek' },
  { code: 'zh', label: '中文' },
] as const

const inviteTemplate = (result: InviteResult) => {
  const accountName = props.target?.account_name ?? ''
  const greeting = inviteTplLang.value === 'zh' ? '您好' : inviteTplLang.value === 'uz' ? 'Assalomu alaykum' : 'Здравствуйте'
  const brand = inviteTplLang.value === 'zh' ? '陶瓷 · B2B' : inviteTplLang.value === 'uz' ? 'Keramika · B2B' : 'Керамика · B2B'
  return tForLocale(inviteTplLang.value as Locale, 'admin.invites.templateBody', {
    greeting,
    accountName,
    expiresDays: 7,
    url: result.url,
    loginEmail: result.loginEmail,
    brand,
  })
}

// 状态统计 / 标签
const inviteStats = computed(() => [
  { key: 'pending', label: t('admin.invites.statPending'),   count: props.invMgr.stats.value.pending, cls: 'bg-blue-400' },
  { key: 'used',    label: t('admin.invites.statUsed'),      count: props.invMgr.stats.value.used,    cls: 'bg-green-400' },
  { key: 'expired', label: t('admin.invites.statExpired'),   count: props.invMgr.stats.value.expired, cls: 'bg-gray-400' },
  { key: 'revoked', label: t('admin.invites.statRevoked'),   count: props.invMgr.stats.value.revoked, cls: 'bg-red-400' },
])

const inviteStatusLabel = (s: string) => {
  const map: Record<string, string> = {
    pending: t('admin.invites.statusPending'),
    used: t('admin.invites.statusUsed'),
    expired: t('admin.invites.statusExpired'),
    revoked: t('admin.invites.statusRevoked'),
  }
  return map[s] ?? s
}

const copy = async (text: string) => {
  try { await navigator.clipboard.writeText(text); alert(t('admin.invites.copied')) }
  catch { prompt(t('admin.invites.copyPrompt'), text) }
}

const copyInviteUrlFor = (inv: { token: string }) =>
  copy(`${window.location.origin}/customer-invite?token=${inv.token}`)

const handleRevoke = (inv: { id: string }) => {
  if (!confirm(t('admin.invites.revokeConfirm'))) return
  emit('revoke', inv.id)
}

// 关闭弹窗时通知父级清干净结果
watch(() => props.open, (v) => {
  if (!v) inviteTab.value = 'send'
})
</script>

<template>
  <Dialog
    :open="open"
    @update:open="emit('update:open', $event)"
    :title="`${t('admin.invites.title')}：${target?.account_name ?? ''}`"
    description=""
    class="lg:!max-w-2xl"
  >
    <div class="space-y-3">
      <!-- Tab -->
      <div class="flex border-b -mx-4 px-1">
        <button
          v-for="tab in inviteTabs" :key="tab.key"
          class="flex-1 px-2 py-2.5 text-sm border-b-2 -mb-px transition-colors text-center"
          :class="inviteTab === tab.key
            ? 'border-primary text-primary font-medium'
            : 'border-transparent text-muted-foreground hover:text-foreground'"
          @click="switchTab(tab.key)"
        >{{ tab.label }}</button>
      </div>

      <!-- ---------- Tab：发链接 ---------- -->
      <div v-if="inviteTab === 'send'" class="space-y-3">
        <div v-if="!inviteResult" class="space-y-2">
          <div class="text-xs text-muted-foreground space-y-1">
            <p>{{ t('admin.invites.sendHint1') }}</p>
            <p>{{ t('admin.invites.sendHint2') }}</p>
          </div>
          <div v-if="!target?.login_email?.trim()" class="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md p-2">
            ✗ {{ t('admin.invites.noEmail') }}
          </div>
          <div v-else class="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md p-2">
            {{ t('admin.invites.willUseEmail') }}：<span class="font-mono">{{ target.login_email }}</span>
          </div>
          <div class="flex justify-end gap-2 pt-2">
            <Button variant="outline" @click="emit('update:open', false)">{{ t('common.cancel') }}</Button>
            <Button @click="emit('generate')" :disabled="loading || !target?.login_email?.trim()">
              <Loader2 v-if="loading" class="mr-2 h-4 w-4 animate-spin" />
              <Mail class="mr-2 h-4 w-4" />
              {{ t('admin.invites.generateBtn') }}
            </Button>
          </div>
        </div>

        <!-- 成功 -->
        <div v-else class="space-y-3">
          <div class="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md p-2">
            {{ t('admin.invites.generated') }}
            {{ t('admin.invites.expiresAt', { d: new Date(inviteResult.expiresAt).toLocaleDateString(locale) }) }}
          </div>
          <div>
            <Label class="text-xs text-muted-foreground">{{ t('admin.invites.colUrl') }}</Label>
            <div class="flex items-center gap-2 mt-1">
              <Input :value="inviteResult.url" readonly class="font-mono text-xs h-9" />
              <Button size="sm" variant="outline" @click="copy(inviteResult.url)">
                <Copy class="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div>
            <Label class="text-xs text-muted-foreground">{{ t('admin.invites.colLoginEmail') }}</Label>
            <div class="flex items-center gap-2 mt-1">
              <Input :value="inviteResult.loginEmail" readonly class="font-mono text-xs h-9" />
              <Button size="sm" variant="outline" @click="copy(inviteResult.loginEmail)">
                <Copy class="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div>
            <Label class="text-xs text-muted-foreground mb-1 block">{{ t('admin.invites.template') }}</Label>
            <div class="flex flex-wrap gap-1 mb-2">
              <button
                v-for="lang in tplLangs" :key="lang.code"
                class="px-2 py-0.5 text-xs rounded border transition-colors"
                :class="inviteTplLang === lang.code
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-muted text-muted-foreground border-transparent hover:text-foreground'"
                @click="inviteTplLang = lang.code"
              >{{ lang.label }}</button>
            </div>
            <div class="p-3 bg-muted rounded-md font-mono text-xs whitespace-pre-wrap">
              {{ inviteTemplate(inviteResult) }}
            </div>
          </div>
          <div class="flex justify-end gap-2 pt-2">
            <Button variant="outline" @click="emit('generate')">
              <RefreshCw class="h-3.5 w-3.5 mr-1" />{{ t('admin.invites.generateAnother') }}
            </Button>
            <Button @click="emit('update:open', false)">{{ t('common.confirm') }}</Button>
          </div>
        </div>
      </div>

      <!-- ---------- Tab：历史记录 ---------- -->
      <div v-if="inviteTab === 'history'">
        <div v-if="invMgr.loading.value" class="space-y-2 py-2">
          <AccountRowSkeleton v-for="i in 4" :key="i" />
        </div>
        <template v-else>
          <div class="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-xs">
            <span v-for="s in inviteStats" :key="s.key" class="flex items-center gap-1">
              <span class="inline-block w-2 h-2 rounded-full flex-shrink-0" :class="s.cls"></span>
              <span class="whitespace-nowrap">{{ s.label }}：<strong>{{ s.count }}</strong></span>
            </span>
          </div>

          <div v-if="!invMgr.invites.value.length" class="text-center text-xs text-muted-foreground py-8">
            {{ t('admin.invites.empty') }}
          </div>

          <div v-else class="space-y-2 overflow-y-auto max-h-[55vh] sm:max-h-none">
            <!-- 桌面端 -->
            <div class="hidden sm:block border rounded-md overflow-hidden">
              <table class="w-full text-xs">
                <thead>
                  <tr class="bg-muted/50 border-b">
                    <th class="px-2 py-1.5 text-left font-medium text-muted-foreground">{{ t('admin.invites.colCreatedAt') }}</th>
                    <th class="px-2 py-1.5 text-left font-medium text-muted-foreground">{{ t('admin.invites.colCreatedBy') }}</th>
                    <th class="px-2 py-1.5 text-left font-medium text-muted-foreground">{{ t('admin.invites.colExpiresAt') }}</th>
                    <th class="px-2 py-1.5 text-left font-medium text-muted-foreground">{{ t('admin.invites.colUsedAt') }}</th>
                    <th class="px-2 py-1.5 text-left font-medium text-muted-foreground">{{ t('admin.invites.colStatus') }}</th>
                    <th class="px-2 py-1.5 text-right font-medium text-muted-foreground">{{ t('admin.invites.colActions') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="inv in invMgr.invites.value" :key="inv.id"
                    class="border-b last:border-0 hover:bg-muted/30">
                    <td class="px-2 py-2">{{ new Date(inv.created_at).toLocaleDateString(locale) }}</td>
                    <td class="px-2 py-2">{{ inv.created_by_name ?? '—' }}</td>
                    <td class="px-2 py-2">{{ new Date(inv.expires_at).toLocaleDateString(locale) }}</td>
                    <td class="px-2 py-2">{{ inv.used_at ? new Date(inv.used_at).toLocaleDateString(locale) : '—' }}</td>
                    <td class="px-2 py-2">
                      <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium"
                        :class="{
                          'bg-blue-50 text-blue-700': inv.status === 'pending',
                          'bg-green-50 text-green-700': inv.status === 'used',
                          'bg-gray-100 text-gray-500': inv.status === 'expired',
                          'bg-red-50 text-red-700': inv.status === 'revoked',
                        }"
                      >{{ inviteStatusLabel(inv.status) }}</span>
                    </td>
                    <td class="px-2 py-2 text-right">
                      <Button v-if="inv.status === 'pending'" size="sm" variant="ghost" class="h-6 px-1.5"
                        @click="copyInviteUrlFor(inv)" :title="t('admin.invites.copyLink')">
                        <Copy class="h-3 w-3" />
                      </Button>
                      <Button v-if="inv.status === 'pending'" size="sm" variant="ghost" class="h-6 px-1.5 text-amber-600 hover:text-amber-700"
                        @click="handleRevoke(inv)" :title="t('admin.invites.revoke')">
                        <X class="h-3 w-3" />
                      </Button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- 移动端 -->
            <div class="sm:hidden space-y-2">
              <div v-for="inv in invMgr.invites.value" :key="inv.id" class="border rounded-md p-3">
                <div class="flex items-center justify-between mb-2">
                  <span class="text-xs text-muted-foreground">{{ new Date(inv.created_at).toLocaleDateString(locale) }}</span>
                  <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium flex-shrink-0"
                    :class="{
                      'bg-blue-50 text-blue-700': inv.status === 'pending',
                      'bg-green-50 text-green-700': inv.status === 'used',
                      'bg-gray-100 text-gray-500': inv.status === 'expired',
                      'bg-red-50 text-red-700': inv.status === 'revoked',
                    }"
                  >{{ inviteStatusLabel(inv.status) }}</span>
                </div>
                <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <div>
                    <span class="text-muted-foreground">{{ t('admin.invites.colCreatedBy') }}</span>
                    <div class="font-medium">{{ inv.created_by_name ?? '—' }}</div>
                  </div>
                  <div>
                    <span class="text-muted-foreground">{{ t('admin.invites.colExpiresAt') }}</span>
                    <div>{{ new Date(inv.expires_at).toLocaleDateString(locale) }}</div>
                  </div>
                  <div>
                    <span class="text-muted-foreground">{{ t('admin.invites.colUsedAt') }}</span>
                    <div>{{ inv.used_at ? new Date(inv.used_at).toLocaleDateString(locale) : '—' }}</div>
                  </div>
                </div>
                <div v-if="inv.status === 'pending'" class="flex gap-2 mt-2 pt-2 border-t">
                  <Button size="sm" variant="outline" class="flex-1 text-xs h-7" @click="copyInviteUrlFor(inv)">
                    <Copy class="h-3 w-3 mr-1" />{{ t('admin.invites.copyLink') }}
                  </Button>
                  <Button size="sm" variant="outline" class="flex-1 text-xs h-7 text-amber-600 border-amber-200 hover:bg-amber-50" @click="handleRevoke(inv)">
                    <X class="h-3 w-3 mr-1" />{{ t('admin.invites.revoke') }}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </Dialog>
</template>