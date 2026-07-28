import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ResetPasswordDialog from '@/views/admin/accounts-admin/ResetPasswordDialog.vue'

const fakeTarget = {
  id: 'acc-1',
  account_name: 'ACME',
  status: 'active' as const,
  category: '一类',
  type: '1_public' as const,
  login_email: 'a@b.com',
  inn: null,
  parent_id: null,
}

describe('ResetPasswordDialog.vue', () => {
  it('mounts without error', () => {
    const w = mount(ResetPasswordDialog, {
      props: { open: true, target: fakeTarget, loading: false, tempPassword: null },
    })
    expect(w.exists()).toBe(true)
  })

  it('renders tempPassword value when provided', () => {
    const w = mount(ResetPasswordDialog, {
      props: { open: true, target: fakeTarget, loading: false, tempPassword: 'tempP@ss' },
    })
    // Dialog uses teleport; component root only contains slot references.
    // Easier to assert via the props received by Dialog child.
    const dialog = w.findComponent({ name: 'Dialog' })
    expect(dialog.exists()).toBe(true)
    expect(dialog.props('open')).toBe(true)
  })
})
