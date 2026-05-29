'use client'

import { memo } from 'react'
import {
  FiEye,
  FiCheck,
  FiX,
  FiUser,
  FiPause,
  FiPlay,
  FiMail,
  FiCalendar,
  FiShield,
  FiAlertCircle,
  FiClock,
} from 'react-icons/fi'

interface Member {
  id: string
  display_name: string
  email: string
  phone_number?: string
  real_name?: string
  created_at: string
  updated_at: string
  registration_status: 'pending' | 'approved' | 'rejected'
  is_active: boolean
  is_admin: boolean
  is_director: boolean
  director_title?: string | null
  is_artist: boolean
  artist_id?: string
  monthly_fee?: number
  bank_name?: string
  account_number?: string
  account_holder?: string
  // 새로운 멤버 상태 관리 필드들
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
  approved_by?: string
  rejected_by?: string
}

interface MemberCardProps {
  member: Member
  onView: () => void
  onAction: (
    memberId: string,
    action: 'approve' | 'reject' | 'deactivate' | 'activate' | 'suspend' | 'unsuspend',
    params?: any
  ) => void
  isLoading: boolean
}

function MemberCard({ member, onView, onAction, isLoading }: MemberCardProps) {
  const getStatusColor = (member: Member) => {
    if (member.is_suspended) {
      return 'bg-red-100 text-red-800'
    }

    switch (member.registration_status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800'
      case 'approved':
        return member.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
      case 'rejected':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const getStatusText = (member: Member) => {
    if (member.is_suspended) {
      return '정지됨'
    }

    switch (member.registration_status) {
      case 'pending':
        return '승인 대기'
      case 'approved':
        return member.is_active ? '승인됨' : '비활성화됨'
      case 'rejected':
        return '거부됨'
      default:
        return '알 수 없음'
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  return (
    <div
      className={`bg-white border rounded-lg p-4 hover:shadow-md transition-shadow ${
        member.is_suspended ? 'border-red-200 bg-red-50' : 'border-gray-200'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-4 flex-1">
          {/* 프로필 아이콘 */}
          <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
            <FiUser className="w-6 h-6 text-gray-500" />
          </div>

          {/* 회원 정보 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center space-x-2">
              <h3 className="text-lg font-semibold text-gray-900 truncate">
                {member.display_name}
              </h3>
              <span
                className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(member)}`}
              >
                {getStatusText(member)}
              </span>
              {member.is_artist && (
                <span className="px-2 py-1 text-xs font-medium bg-purple-100 text-purple-800 rounded-full">
                  아티스트
                </span>
              )}
              {member.is_admin && (
                <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
                  관리자
                </span>
              )}
              {member.is_director && (
                <span className="px-2 py-1 text-xs font-medium bg-teal-100 text-teal-800 rounded-full">
                  이사{member.director_title ? ` (${member.director_title})` : ''}
                </span>
              )}
              {member.membership_type === 'premium' && (
                <span className="px-2 py-1 text-xs font-medium bg-indigo-100 text-indigo-800 rounded-full">
                  프리미엄
                </span>
              )}
              {member.membership_type === 'lifetime' && (
                <span className="px-2 py-1 text-xs font-medium bg-gradient-to-r from-purple-100 to-pink-100 text-purple-800 rounded-full">
                  평생
                </span>
              )}
            </div>

            <div className="mt-1 space-y-1">
              <div className="flex items-center text-sm text-gray-600">
                <FiMail className="w-4 h-4 mr-1" />
                <span className="truncate">{member.email}</span>
              </div>
              {member.real_name && (
                <div className="text-sm text-gray-600">실명: {member.real_name}</div>
              )}
              <div className="flex items-center text-sm text-gray-500">
                <FiCalendar className="w-4 h-4 mr-1" />
                <span>가입일: {formatDate(member.created_at)}</span>
              </div>

              {/* 추가 정보 표시 */}
              <div className="flex items-center gap-4 text-xs text-gray-500 mt-1">
                <span>프로필: {member.profile_completeness_score}%</span>
                <span>참여도: {member.engagement_score}점</span>
                {member.last_login_at && (
                  <span>최근 로그인: {formatDate(member.last_login_at)}</span>
                )}
              </div>

              {member.is_suspended && member.suspension_reason && (
                <div className="flex items-center text-sm text-red-600 mt-1">
                  <FiAlertCircle className="w-4 h-4 mr-1" />
                  <span>정지 사유: {member.suspension_reason}</span>
                  {member.suspension_until && (
                    <span className="ml-2 text-gray-500">
                      (~{formatDate(member.suspension_until)})
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 액션 버튼 */}
        <div className="flex items-center space-x-2 ml-4">
          {/* 상세 보기 버튼 */}
          <button
            onClick={onView}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
            title="상세 보기"
          >
            <FiEye className="w-4 h-4" />
          </button>

          {/* 승인/거부 버튼 (승인 대기 상태에서만) */}
          {member.registration_status === 'pending' && (
            <>
              <button
                onClick={() => onAction(member.id, 'approve')}
                disabled={isLoading}
                className="p-2 text-green-600 hover:text-green-700 hover:bg-green-50 rounded-md transition-colors disabled:opacity-50"
                title="승인"
              >
                <FiCheck className="w-4 h-4" />
              </button>
              <button
                onClick={() => onAction(member.id, 'reject')}
                disabled={isLoading}
                className="p-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors disabled:opacity-50"
                title="거부"
              >
                <FiX className="w-4 h-4" />
              </button>
            </>
          )}

          {/* 활성화/비활성화 버튼 (승인된 사용자에 대해서만) */}
          {member.registration_status === 'approved' && (
            <>
              <button
                onClick={() => onAction(member.id, member.is_active ? 'deactivate' : 'activate')}
                disabled={isLoading}
                className={`p-2 rounded-md transition-colors disabled:opacity-50 ${
                  member.is_active
                    ? 'text-orange-600 hover:text-orange-700 hover:bg-orange-50'
                    : 'text-green-600 hover:text-green-700 hover:bg-green-50'
                }`}
                title={member.is_active ? '비활성화' : '활성화'}
              >
                {member.is_active ? (
                  <FiPause className="w-4 h-4" />
                ) : (
                  <FiPlay className="w-4 h-4" />
                )}
              </button>

              {/* 정지/정지해제 버튼 */}
              <button
                onClick={() => {
                  if (member.is_suspended) {
                    onAction(member.id, 'unsuspend')
                  } else {
                    const reason = prompt('정지 사유를 입력하세요:', '이용규칙 위반')
                    if (!reason) return

                    const until = prompt(
                      '정지 기간을 입력하세요 (YYYY-MM-DD 형식, 비우면 무기한):',
                      ''
                    )

                    const params: any = { suspension_reason: reason }
                    if (until) {
                      params.suspension_until = until
                    }

                    onAction(member.id, 'suspend', params)
                  }
                }}
                disabled={isLoading}
                className={`p-2 rounded-md transition-colors disabled:opacity-50 ${
                  member.is_suspended
                    ? 'text-blue-600 hover:text-blue-700 hover:bg-blue-50'
                    : 'text-red-600 hover:text-red-700 hover:bg-red-50'
                }`}
                title={member.is_suspended ? '정지해제' : '정지'}
              >
                <FiShield className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* 로딩 상태 */}
      {isLoading && (
        <div className="mt-2 flex items-center text-sm text-gray-500">
          <div className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mr-2"></div>
          처리 중...
        </div>
      )}
    </div>
  )
}

export default memo(MemberCard)
