/**
 * useTeamMembers — 团队成员（客服/员工）加载 composable
 * 复用 StaffWorkspacePage、ChatPanel 中的 loadStaffOptions 逻辑，
 * 模块级缓存避免重复查询。
 */
import { ref } from 'vue'
import { supabase } from '@/lib/supabase'

export interface TeamMember {
  id: string
  full_name: string | null
  role: string
}

const members = ref<TeamMember[]>([])
const loading = ref(false)
let _fetched = false

export function useTeamMembers() {
  const load = async () => {
    if (_fetched && members.value.length > 0) return
    loading.value = true
    try {
      const { data } = await supabase
        .from('users')
        .select('id, full_name, role')
        .in('role', ['admin', 'checker', 'finance', 'warehouse'])
        .order('full_name', { ascending: true })
      members.value = (data ?? []) as TeamMember[]
      _fetched = true
    } finally {
      loading.value = false
    }
  }

  return { members, loading, load }
}
