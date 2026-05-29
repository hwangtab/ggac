import type { ProfilePhotoMetadata } from './media'

/**
 * 조합원 프로필 정보.
 *
 * 결제·은행 정보(monthly_fee, bank_name, account_number, account_holder),
 * suspension_*(is_suspended/suspension_reason/suspension_until),
 * profile_completeness_score, verification_status, engagement_score 필드는
 * 모두 관리자 UI 또는 회원 가입/마이페이지에서 실제 사용 중임을 확인함
 * (2026-05 audit). 추가 정리 필요 시 사용처 grep 후 제거.
 */
export interface MemberProfile {
  id: string
  display_name: string
  email: string
  phone_number?: string
  birth_date?: string
  real_name?: string
  monthly_fee?: number
  bank_name?: string
  account_number?: string
  account_holder?: string
  registration_status: 'pending' | 'approved' | 'rejected'
  is_active: boolean
  is_admin: boolean
  is_member: boolean
  created_at: string
  updated_at: string
  approved_at?: string
  approved_by?: string
  rejected_by?: string

  // 이사회 관련 필드
  is_director: boolean

  // 아티스트 관련 필드
  artist_id?: string | null
  is_artist: boolean
  artist_role: 'owner' | 'manager' | 'collaborator'

  // 프로필 사진 관련 필드
  profile_photo_url?: string | null
  profile_photo_metadata?: ProfilePhotoMetadata

  // 새로운 상태 관리 필드
  last_login_at?: string
  is_suspended: boolean
  suspension_reason?: string
  suspension_until?: string
  profile_completeness_score: number
  verification_status: {
    email: boolean
    phone: boolean
    identity: boolean
  }
  membership_type: 'regular' | 'premium' | 'lifetime'
  engagement_score: number
}

export interface MemberStatusHistory {
  id: string
  member_id: string
  changed_by?: string
  action:
    | 'approve'
    | 'reject'
    | 'activate'
    | 'deactivate'
    | 'suspend'
    | 'unsuspend'
    | 'promote'
    | 'demote'
    | 'update'
  previous_status: any
  new_status: any
  reason?: string
  metadata: any
  created_at: string
  ip_address?: string
  user_agent?: string
  changed_by_member?: {
    display_name: string
    email: string
  }
}

export interface MemberLoginHistory {
  id: string
  member_id: string
  login_at: string
  ip_address?: string
  user_agent?: string
  success: boolean
  failure_reason?: string
}

export interface MemberBulkOperation {
  id: string
  operation_type:
    | 'bulk_approve'
    | 'bulk_reject'
    | 'bulk_activate'
    | 'bulk_deactivate'
    | 'bulk_suspend'
    | 'bulk_export'
  performed_by: string
  member_ids: string[]
  parameters: any
  results: any
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
  created_at: string
  started_at?: string
  completed_at?: string
  error_message?: string
  performed_by_member?: {
    display_name: string
    email: string
  }
}

export interface MemberStatistics {
  totalMembers: number
  activeMembers: number
  inactiveMembers: number
  pendingMembers: number
  approvedMembers: number
  rejectedMembers: number
  suspendedMembers: number
  artistMembers: number
  adminMembers: number
  directorMembers: number
  monthlyRegistrations: {
    month: string
    count: number
  }[]
  membershipTypeDistribution: {
    regular: number
    premium: number
    lifetime: number
  }
  averageProfileCompleteness: number
  averageEngagementScore: number
}

export interface BulkOperationRequest {
  operation_type:
    | 'bulk_approve'
    | 'bulk_reject'
    | 'bulk_activate'
    | 'bulk_deactivate'
    | 'bulk_suspend'
  member_ids: string[]
  parameters?: {
    suspension_reason?: string
    suspension_until?: string
    metadata?: any
  }
}

export type MemberAction =
  | 'approve'
  | 'reject'
  | 'activate'
  | 'deactivate'
  | 'suspend'
  | 'unsuspend'
  | 'promote'
  | 'demote'

export interface MemberFilterOptions {
  registration_status?: 'pending' | 'approved' | 'rejected' | 'all'
  is_active?: boolean
  is_suspended?: boolean
  is_artist?: boolean
  is_admin?: boolean
  membership_type?: 'regular' | 'premium' | 'lifetime'
  date_range?: {
    start: string
    end: string
  }
  min_profile_completeness?: number
  min_engagement_score?: number
  search?: string
  sort_by?: 'created_at' | 'updated_at' | 'last_login_at' | 'display_name' | 'engagement_score'
  sort_order?: 'asc' | 'desc'
}

export type MemberProfileSummary = Pick<
  MemberProfile,
  | 'id'
  | 'display_name'
  | 'email'
  | 'is_artist'
  | 'artist_id'
  | 'artist_role'
  | 'registration_status'
  | 'is_active'
>

export interface ProfileEditFormProps {
  profile: MemberProfile
  onUpdate: (updates: Partial<MemberProfile>) => Promise<void>
  loading?: boolean
  className?: string
}

export interface ProfileUpdateRequest {
  display_name?: string
  phone_number?: string
  birth_date?: string
  monthly_fee?: number
  bank_name?: string
  account_number?: string
  account_holder?: string
}

export interface MypageLayoutProps {
  children: React.ReactNode
  title: string
  description?: string
  className?: string
}

export interface MypageMenuItem {
  id: string
  label: string
  href: string
  icon?: React.ComponentType<{ className?: string }>
  requiredPermission?: 'member' | 'artist' | 'admin'
  badge?: string | number
  isActive?: boolean
}

export interface PermissionCheckProps {
  children: React.ReactNode
  requiredPermission: 'member' | 'artist' | 'admin'
  fallback?: React.ReactNode
  redirectTo?: string
}

export function isMemberProfile(obj: any): obj is MemberProfile {
  return (
    typeof obj === 'object' &&
    typeof obj.id === 'string' &&
    typeof obj.display_name === 'string' &&
    typeof obj.email === 'string' &&
    typeof obj.registration_status === 'string' &&
    typeof obj.is_active === 'boolean' &&
    typeof obj.is_artist === 'boolean'
  )
}
