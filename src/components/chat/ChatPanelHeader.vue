<!--
  ChatPanelHeader — 顶部标题栏
  - 显示对方信息（头像、名称、在线状态）
  - 订单关联徽章
  - 连接状态指示
  - 操作按钮（跳转订单、发送订单卡片、接管/转接菜单）
-->
<script setup lang="ts">
import { computed } from 'vue'
import { ArrowLeft, ExternalLink, Wifi, WifiOff, Package, ArrowRightLeft, UserPlus } from 'lucide-vue-next'
import { useI18n } from '@/lib/i18n'
import type { ChatMember, ChatConversation } from '@/composables/useChat'
import ChatAvatar from './ChatAvatar.vue'
import Badge from '@/components/ui/Badge.vue'
import Button from '@/components/ui/Button.vue'

const props = defineProps<{
  conversation: ChatConversation | null
  counterpart: ChatMember | null
  counterpartName: string
  counterpartStatus: 'online' | 'offline' | 'away'
  connection: 'online' | 'reconnecting' | 'offline'
  contextLabel?: string
  embedded?: boolean
  sendOrderCardHandler?: (() => Promise<string | void> | string | void) | undefined
  staffOptions: { id: string; full_name: string | null; role: string }[]
  isStaff: boolean
}>()

const emit = defineEmits<{
  close: []
  sendOrderCard: []
  postSystem: []
  takeOver: []
  toggleActionMenu: []
  toggleTransferMenu: []
  transfer: [staffId: string | null]
  unassign: []
}>()

const { t } = useI18n()

const assignedStaffName = computed(() => {
  if (!props.conversation?.assigned_to) return null
  return props.staffOptions.find((s) => s.id === props.conversation?.assigned_to)?.full_name ?? '—'
})
</script>

<template>
  <!-- 非嵌入模式 -->
  <div
    v-if="!embedded"
    class="h-12 px-3 border-b flex items-center gap-2 bg-background sticky top-0 z-10"
  >
    <Button
      v-if="$slots['back']"
      size="icon"
      variant="ghost"
      @click="emit('close')"
    >
      <ArrowLeft class="h-4 w-4" />
    </Button>
    <ChatAvatar
      :name="counterpartName"
      :role="counterpart?.member_type ?? 'staff'"
      size="sm"
    />
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-1.5">
        <span class="text-sm font-semibold truncate">{{ counterpartName }}</span>
        <slot name="status-dot" />
        <Badge v-if="conversation?.subject_order_id" variant="secondary" class="text-[10px]">
          {{ t('chat.orderBadge') }}
        </Badge>
      </div>
      <p class="text-[10px] text-muted-foreground truncate">
        {{
          conversation?.subject_order
            ? `${t('chat.orderRef')}: ${conversation.subject_order.order_no}`
            : (contextLabel ?? t('chat.subtitle'))
        }}
      </p>
    </div>
    <div class="flex items-center gap-1">
      <Wifi v-if="connection === 'online'" class="h-3.5 w-3.5 text-emerald-500" />
      <WifiOff v-else class="h-3.5 w-3.5 text-destructive" />
      <span v-if="connection !== 'online'" class="text-[10px] text-destructive">
        {{ t('chat.connectError') }}
      </span>
      <Button
        v-if="conversation?.subject_order_id"
        size="icon"
        variant="ghost"
        :title="t('chat.viewOrder')"
        @click="$router.push(`/orders/${conversation.subject_order_id}`)"
      >
        <ExternalLink class="h-4 w-4" />
      </Button>
      <Button
        v-if="sendOrderCardHandler"
        size="sm"
        variant="outline"
        :title="t('chat.sendOrderCard')"
        @click="emit('sendOrderCard')"
      >
        <Package class="h-3.5 w-3.5" />
        <span class="hidden lg:inline">{{ t('chat.sendOrderCard') }}</span>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        :title="t('chat.postSystem')"
        @click="emit('postSystem')"
      >
        📣
      </Button>
      <!-- 接管 / 转接 (staff) -->
      <div v-if="isStaff" class="relative chat-action-menu">
        <Button
          size="sm"
          variant="ghost"
          :title="t('chat.takeOverOrTransfer')"
          @click="emit('toggleActionMenu')"
        >
          <ArrowRightLeft class="h-3.5 w-3.5" />
          <span class="hidden lg:inline">
            {{ conversation?.assigned_to
              ? `${t('chat.assignedTo')}: ${assignedStaffName}`
              : t('chat.takeOver') }}
          </span>
        </Button>
        <slot name="action-menu" />
      </div>
    </div>
  </div>

  <!-- 嵌入模式 -->
  <div
    v-else
    class="px-3 py-2 border-b flex items-center gap-2 bg-muted/30"
  >
    <ChatAvatar
      :name="counterpartName"
      :role="counterpart?.member_type ?? 'staff'"
      size="sm"
    />
    <div class="min-w-0 flex-1">
      <p class="text-sm font-semibold truncate flex items-center gap-1.5">
        {{ counterpartName }}
        <slot name="status-dot" />
      </p>
      <p class="text-[10px] text-muted-foreground truncate">
        {{
          conversation?.subject_order
            ? `${t('chat.orderRef')}: ${conversation.subject_order.order_no}`
            : (contextLabel ?? t('chat.subtitle'))
        }}
      </p>
    </div>
    <Button
      v-if="sendOrderCardHandler"
      size="icon"
      variant="ghost"
      :title="t('chat.sendOrderCard')"
      @click="emit('sendOrderCard')"
    >
      <Package class="h-3.5 w-3.5" />
    </Button>
    <Button
      v-if="isStaff"
      size="icon"
      variant="ghost"
      :title="t('chat.takeOver')"
      @click="emit('takeOver')"
    >
      <UserPlus class="h-3.5 w-3.5" />
    </Button>
  </div>
</template>
