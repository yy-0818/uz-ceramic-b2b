/**
 * v-permission 元素级权限指令
 *
 * 用法：
 *   <Button v-permission="'order:audit'">审核</Button>
 *   <Button v-permission="['order:audit','order:ship']">操作</Button>
 *   <Button v-permission:guest="'order:create'">下单（仅非客户）</Button>
 */
import type { Directive } from 'vue'
import { useAuth, type Permission } from '@/composables/useAuth'

export const permissionDirective: Directive<HTMLElement, Permission | Permission[]> = {
  mounted(el, binding) {
    apply(el, binding.value as any, !!binding.modifiers?.guest)
  },
  updated(el, binding) {
    apply(el, binding.value as any, !!binding.modifiers?.guest)
  },
}

function apply(el: HTMLElement, value: Permission | Permission[], isGuest: boolean) {
  const { hasPermission } = useAuth()
  const ok = hasPermission(value)
  const show = isGuest ? !ok : ok
  el.style.display = show ? '' : 'none'
}

export function registerPermissionDirective(app: import('vue').App) {
  app.directive('permission', permissionDirective)
}
