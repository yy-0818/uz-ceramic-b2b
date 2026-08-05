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
import { Plus, RefreshCcw, ShieldCheck, Package, Wallet, Wrench } from 'lucide-vue-next'
import { useI18n } from '@/lib/i18n'
import { useStaffManagement, type StaffRole, type StaffMember } from '@/composables/useStaffManagement'

const { t } = useI18n()
const { members, loading, error, fetchMembers, createMember, roles } = useStaffManagement()

const showDialog = ref(false)
const submitting = ref(false)
const dialogError = ref<string | null>(null)
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
    case 'admin': return ShieldCheck
    case 'checker': return ShieldCheck
    case 'warehouse': return Package
    case 'finance': return Wallet
    default: return Wrench
  }
}

const grouped = computed(() => {
  const out: Record<StaffRole, StaffMember[]> = {
    admin: [], checker: [], warehouse: [], finance: [],
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
    email: '', password: '', password2: '',
    role: 'checker', full_name: '', phone: '',
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
  </div>
</template>
