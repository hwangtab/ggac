import type { Database } from '@work/types/supabase'

export type StaffRow = Database['work']['Tables']['staff']['Row']
export type StaffRole = Database['work']['Enums']['staff_role']
export type StaffStatus = Database['work']['Enums']['staff_status']

/** 업무툴 관리자 역할(owner·admin). kosmartweb profiles.role 과 무관하다. */
export function isWorkAdminRole(role: StaffRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin'
}

/** 업무툴에 들어올 수 있는 staff 인가(status active). */
export function isActiveStaff(staff: Pick<StaffRow, 'status'> | null | undefined): boolean {
  return staff?.status === 'active'
}

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  owner: '소유자',
  admin: '관리자',
  member: '이사회 구성원',
  guest: '외부 참여자',
}
