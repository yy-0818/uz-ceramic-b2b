<script setup lang="ts">
/**
 * StaffManagementPage —— admin 员工账号管理
 *
 * 功能：
 *   - 列表：显示现有员工 (admin / checker / warehouse / finance)
 *   - 新建：模态框填写邮箱 + 初始密码 + 角色 + 姓名
 *   - 禁用/启用：留接口，迁移 0026 后接入
 */
import { ref, onMounted, computed } from 'vue'
import { Plus, RefreshCcw, ShieldCheck, Package, Wallet, Wrench, KeyRound, Copy, Loader2 } from 'lucide-vue-next'
import { useI18n } from '@/lib/i18n'
import { useStaffManagement, type StaffRole, type StaffMember } from '@/composables/useStaffManagement'
import { reportIfInteresting } from '@/lib/sentry'

const { t } = useI18n()
const { members, loading, error, fetchMembers, createMember, resetPassword, roles } = useStaffManagement()

const showDialog = ref(false)
const submitting = ref(false)
const dialogError = ref<string | null>(null)

// 重置密码 dialog 状态
const resetTarget = ref<StaffMember | null>(null)
const resetTempPassword = ref<string | null>(null)
const resetEmail = ref<string | null>(null)
const resetLoading = ref(false)
const resetCopied = ref(false)
const form = ref<{
  email: string
  password: string
  password2: string
  role: StaffRole
  full_name: string
  phone: string
}>({
  email: '',
  password: '',
  password2: '',
  role: 'checker',
  full_name: '',
  phone: '',
})

const roleIcon = (r: StaffRole) => {
  switch (r) {
    case 'admin':
      return ShieldCheck
    case 'checker':
      return ShieldCheck
    case 'warehouse':
      return Package
    case 'finance':
      return Wallet
    default:
      return Wrench
  }
}

const grouped = computed(() => {
  const out: Record<StaffRole, StaffMember[]> = {
    admin: [],
    checker: [],
    warehouse: [],
    finance: [],
  }
  for (const m of members.value) {
    if (m.role in out) out[m.role as StaffRole].push(m)
  }
  return out
})

onMounted(() => fetchMembers())

const onOpenDialog = () => {
  showDialog.value = true
  dialogError.value = null
  form.value = {
    email: '',
    password: '',
    password2: '',
    role: 'checker',
    full_name: '',
    phone: '',
  }
}

const onSubmit = async () => {
  dialogError.value = null
  const v = form.value
  if (v.password !== v.password2) {
    dialogError.value = t('staff.passwordMismatch')
    return
  }
  submitting.value = true
  const r = await createMember({
    email: v.email.trim(),
    password: v.password,
    role: v.role,
    full_name: v.full_name.trim(),
    phone: v.phone.trim() || undefined,
  })
  submitting.value = false
  if (r.ok) {
    showDialog.value = false
  } else {
    dialogError.value = r.error ?? t('staff.createFail')
  }
}

const openResetDialog = (m: StaffMember) => {
  resetTarget.value = m
  resetTempPassword.value = null
  resetEmail.value = null
  resetCopied.value = false
}

const closeResetDialog = () => {
  resetTarget.value = null
  resetTempPassword.value = null
  resetEmail.value = null
  resetLoading.value = false
  resetCopied.value = false
}

const onResetPassword = async () => {
  if (!resetTarget.value) return
  resetLoading.value = true
  const r = await resetPassword(resetTarget.value.id)
  resetLoading.value = false
  if (r.ok && r.tempPassword) {
    resetTempPassword.value = r.tempPassword
    resetEmail.value = r.email ?? null
  } else {
    // 用 alert 简单提示错误 (staff 页面已用 alert-error 风格)
    reportIfInteresting(new Error(r.error ?? '重置失败'), { phase: 'resetStaffPassword' })
    alert(r.error ?? '重置失败')
  }
}

const copyTempPassword = async () => {
  if (!resetTempPassword.value) return
  try {
    await navigator.clipboard.writeText(resetTempPassword.value)
    resetCopied.value = true
    setTimeout(() => (resetCopied.value = false), 1500)
  } catch {
    /* clipboard 不可用, 用户手动复制 */
  }
}
</script>

<template>
  <div class="p-4 md:p-6 max-w-6xl mx-auto">
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-semibold">{{ t('staff.title') }}</h1>
      <div class="flex gap-2">
        <button class="btn btn-outline btn-sm" @click="fetchMembers" :disabled="loading">
          <RefreshCcw class="w-4 h-4" />
          {{ t('common.refresh') }}
        </button>
        <button class="btn btn-primary btn-sm" @click="onOpenDialog">
          <Plus class="w-4 h-4" />
          {{ t('staff.createBtn') }}
        </button>
      </div>
    </div>

    <div v-if="error" class="alert alert-error mb-4">{{ error }}</div>

    <div class="grid md:grid-cols-2 gap-4">
      <div v-for="role in roles" :key="role" class="card bg-base-100 shadow-sm">
        <div class="card-body">
          <div class="flex items-center gap-2 mb-2">
            <component :is="roleIcon(role)" class="w-5 h-5 opacity-70" />
            <h2 class="card-title text-base">{{ t(`staff.role.${role}`) }}</h2>
            <span class="badge badge-ghost ml-auto">{{ grouped[role].length }}</span>
          </div>

          <div v-if="loading && members.length === 0" class="text-sm opacity-60 py-4 text-center">
            {{ t('common.loading') }}
          </div>
          <div v-else-if="grouped[role].length === 0" class="text-sm opacity-60 py-4 text-center">
            {{ t('staff.empty') }}
          </div>
          <ul v-else class="divide-y">
            <li v-for="m in grouped[role]" :key="m.id" class="py-3 flex items-center gap-3">
              <div class="flex-1">
                <div class="font-medium">{{ m.full_name || '—' }}</div>
                <div class="text-sm opacity-70" v-if="m.email">{{ m.email }}</div>
                <div class="text-sm opacity-70" v-else>{{ m.phone || `id: ${m.id.slice(0, 8)}…` }}</div>
              </div>
              <span class="badge badge-ghost">{{ m.is_active ? t('staff.active') : t('staff.inactive') }}</span>
              <button class="btn btn-ghost btn-xs" title="重置密码" @click="openResetDialog(m)">
                <KeyRound class="w-3.5 h-3.5" />
              </button>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- 创建对话框 -->
    <dialog class="modal" :open="showDialog">
      <div class="modal-box">
        <h3 class="font-bold text-lg mb-4">{{ t('staff.createTitle') }}</h3>
        <div v-if="dialogError" class="alert alert-error mb-3">{{ dialogError }}</div>
        <form @submit.prevent="onSubmit" class="space-y-3">
          <label class="form-control">
            <span class="label-text">{{ t('staff.field.email') }} *</span>
            <input v-model="form.email" type="email" class="input input-bordered" required />
          </label>
          <label class="form-control">
            <span class="label-text">{{ t('staff.field.password') }} * (≥8)</span>
            <input v-model="form.password" type="password" class="input input-bordered" required minlength="8" />
          </label>
          <label class="form-control">
            <span class="label-text">{{ t('staff.field.password2') }} *</span>
            <input v-model="form.password2" type="password" class="input input-bordered" required minlength="8" />
          </label>
          <label class="form-control">
            <span class="label-text">{{ t('staff.field.full_name') }} *</span>
            <input v-model="form.full_name" type="text" class="input input-bordered" required />
          </label>
          <label class="form-control">
            <span class="label-text">{{ t('staff.field.phone') }}</span>
            <input v-model="form.phone" type="tel" class="input input-bordered" />
          </label>
          <label class="form-control">
            <span class="label-text">{{ t('staff.field.role') }} *</span>
            <select v-model="form.role" class="select select-bordered">
              <option v-for="r in roles" :key="r" :value="r">
                {{ t(`staff.role.${r}`) }}
              </option>
            </select>
          </label>
          <div class="modal-action">
            <button type="button" class="btn" @click="showDialog = false">{{ t('common.cancel') }}</button>
            <button type="submit" class="btn btn-primary" :disabled="submitting">
              <span v-if="submitting" class="loading loading-spinner loading-xs mr-1"></span>
              {{ t('common.submit') }}
            </button>
          </div>
        </form>
      </div>
      <form method="dialog" class="modal-backdrop"><button @click="showDialog = false">close</button></form>
    </dialog>

    <!-- 重置密码对话框 -->
    <dialog class="modal" :open="resetTarget !== null">
      <div class="modal-box">
        <h3 class="font-bold text-lg mb-4">重置密码：{{ resetTarget?.full_name || resetTarget?.email || '员工' }}</h3>

        <!-- step 1: 确认 -->
        <div v-if="!resetTempPassword" class="space-y-3">
          <p class="text-sm text-base-content/70">将生成新的临时密码。员工登录后建议自行修改。</p>
          <div class="modal-action">
            <button class="btn" @click="closeResetDialog">取消</button>
            <button class="btn btn-primary" :disabled="resetLoading" @click="onResetPassword">
              <Loader2 v-if="resetLoading" class="w-4 h-4 mr-1 animate-spin" />
              <KeyRound v-else class="w-4 h-4 mr-1" />
              生成临时密码
            </button>
          </div>
        </div>

        <!-- step 2: 显示临时密码 -->
        <div v-else class="space-y-3">
          <div class="alert alert-warning text-xs">
            临时密码已生成，请复制并安全转交给员工。本对话框关闭后无法再次查看。
          </div>
          <div v-if="resetEmail" class="text-xs text-base-content/60">登录邮箱：{{ resetEmail }}</div>
          <div class="flex items-center gap-2">
            <input :value="resetTempPassword" readonly class="input input-bordered input-sm flex-1 font-mono" />
            <button class="btn btn-outline btn-sm" @click="copyTempPassword">
              <Copy class="w-3.5 h-3.5" />
              {{ resetCopied ? '已复制' : '复制' }}
            </button>
          </div>
          <div class="modal-action">
            <button class="btn btn-primary" @click="closeResetDialog">完成</button>
          </div>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop"><button @click="closeResetDialog">close</button></form>
    </dialog>
  </div>
</template>
