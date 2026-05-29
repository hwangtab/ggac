'use client'

import {
  FiX,
  FiCheck,
  FiUser,
  FiMail,
  FiPhone,
  FiCalendar,
  FiDollarSign,
  FiCreditCard,
  FiShield,
  FiMusic,
  FiPause,
  FiPlay,
  FiAlertCircle,
} from 'react-icons/fi'
import { useEffect, useRef, useState } from 'react'
import { useDialogA11y } from '@/hooks/useDialogA11y'

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

interface MemberDetailModalProps {
  member: Member
  isOpen: boolean
  onClose: () => void
  onAction: (
    memberId: string,
    action: 'approve' | 'reject' | 'deactivate' | 'activate' | 'suspend' | 'unsuspend',
    params?: any
  ) => void
  onFlagsUpdate?: (memberId: string, flags: { is_director?: boolean; director_title?: string | null }) => Promise<void>
  isLoading: boolean
}

export default function MemberDetailModal({
  member,
  isOpen,
  onClose,
  onAction,
  onFlagsUpdate,
  isLoading,
}: MemberDetailModalProps) {
  const [confirmAction, setConfirmAction] = useState<{ action: string; title: string } | null>(null)
  const [directorChecked, setDirectorChecked] = useState(member.is_director)
  const [directorTitle, setDirectorTitle] = useState(member.director_title ?? '')
  const [flagsLoading, setFlagsLoading] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)

  useDialogA11y({ containerRef: dialogRef, onClose, isOpen })

  useEffect(() => {
    if (!isOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isOpen])

  // 모달이 열릴 때 이사 상태 동기화
  useEffect(() => {
    if (isOpen) {
      setDirectorChecked(member.is_director)
      setDirectorTitle(member.director_title ?? '')
    }
  }, [isOpen, member.is_director, member.director_title])

  const handleDirectorToggle = async (checked: boolean) => {
    if (!onFlagsUpdate) return
    setDirectorChecked(checked)
    setFlagsLoading(true)
    try {
      await onFlagsUpdate(member.id, {
        is_director: checked,
        director_title: checked ? (directorTitle || null) : null,
      })
    } catch {
      // 실패 시 원래 상태로 복원
      setDirectorChecked(!checked)
    } finally {
      setFlagsLoading(false)
    }
  }

  const handleDirectorTitleSave = async () => {
    if (!onFlagsUpdate) return
    setFlagsLoading(true)
    try {
      await onFlagsUpdate(member.id, {
        is_director: directorChecked,
        director_title: directorTitle || null,
      })
    } catch {
      // 실패 시 마지막으로 저장된 직책으로 복원
      setDirectorTitle(member.director_title ?? '')
    } finally {
      setFlagsLoading(false)
    }
  }

  if (!isOpen) return null

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800'
      case 'approved':
        return 'bg-green-100 text-green-800'
      case 'rejected':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending':
        return '승인 대기'
      case 'approved':
        return '승인됨'
      case 'rejected':
        return '거부됨'
      default:
        return '알 수 없음'
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatCurrency = (amount?: number) => {
    if (!amount) return '설정되지 않음'
    return new Intl.NumberFormat('ko-KR', {
      style: 'currency',
      currency: 'KRW',
    }).format(amount)
  }

  const handleAction = (
    action: 'approve' | 'reject' | 'deactivate' | 'activate' | 'suspend' | 'unsuspend'
  ) => {
    const actionTitles = {
      approve: '승인',
      reject: '거부',
      deactivate: '비활성화',
      activate: '활성화',
      suspend: '정지',
      unsuspend: '정지해제',
    }

    setConfirmAction({ action, title: actionTitles[action] })
  }

  const confirmActionHandler = () => {
    if (confirmAction) {
      if (confirmAction.action === 'suspend') {
        const reason = prompt('정지 사유를 입력하세요:', '이용규칙 위반')
        if (!reason) return

        const until = prompt('정지 기간을 입력하세요 (YYYY-MM-DD 형식, 비우면 무기한):', '')

        const params: any = { suspension_reason: reason }
        if (until) {
          params.suspension_until = until
        }

        onAction(member.id, confirmAction.action as any, params)
      } else {
        onAction(member.id, confirmAction.action as any)
      }
      setConfirmAction(null)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-2 sm:p-4 z-50 overflow-y-auto"
      role="presentation"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-detail-modal-title"
        tabIndex={-1}
        className="bg-white rounded-lg shadow-xl w-full max-w-xs sm:max-w-sm md:max-w-lg lg:max-w-2xl xl:max-w-4xl min-h-0 max-h-full my-4 sm:my-8 overflow-hidden flex flex-col"
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-200 flex-shrink-0">
          <h2
            id="member-detail-modal-title"
            className="text-lg sm:text-xl font-semibold text-gray-900 truncate"
          >
            회원 상세 정보
          </h2>
          <button
            type="button"
            aria-label="모달 닫기"
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-md transition-colors flex-shrink-0 ml-2"
          >
            <FiX className="w-5 h-5" />
          </button>
        </div>

        {/* 콘텐츠 */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1">
          <div className="space-y-4 sm:space-y-6">
            {/* 기본 정보 */}
            <div className="bg-gray-50 rounded-lg p-3 sm:p-4">
              <div className="flex flex-col sm:flex-row sm:items-center mb-4 space-y-3 sm:space-y-0">
                <div className="w-12 h-12 sm:w-16 sm:h-16 bg-gray-200 rounded-full flex items-center justify-center flex-shrink-0">
                  <FiUser className="w-6 h-6 sm:w-8 sm:h-8 text-gray-500" />
                </div>
                <div className="sm:ml-4 min-w-0 flex-1">
                  <h3 className="text-base sm:text-lg font-semibold text-gray-900 truncate">
                    {member.display_name}
                  </h3>
                  <div className="flex flex-wrap gap-1 sm:gap-2 mt-1">
                    <span
                      className={`px-2 py-1 text-xs font-medium rounded-full whitespace-nowrap ${getStatusColor(member.registration_status)}`}
                    >
                      {getStatusText(member.registration_status)}
                    </span>
                    {member.is_artist && (
                      <span className="px-2 py-1 text-xs font-medium bg-purple-100 text-purple-800 rounded-full whitespace-nowrap">
                        아티스트
                      </span>
                    )}
                    {member.is_admin && (
                      <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full whitespace-nowrap">
                        관리자
                      </span>
                    )}
                    {member.is_director && (
                      <span className="px-2 py-1 text-xs font-medium bg-teal-100 text-teal-800 rounded-full whitespace-nowrap">
                        이사{member.director_title ? ` (${member.director_title})` : ''}
                      </span>
                    )}
                    {member.is_suspended && (
                      <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded-full whitespace-nowrap">
                        정지됨
                      </span>
                    )}
                    {!member.is_active && (
                      <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-800 rounded-full whitespace-nowrap">
                        비활성화됨
                      </span>
                    )}
                    {member.membership_type === 'premium' && (
                      <span className="px-2 py-1 text-xs font-medium bg-indigo-100 text-indigo-800 rounded-full whitespace-nowrap">
                        프리미엄
                      </span>
                    )}
                    {member.membership_type === 'lifetime' && (
                      <span className="px-2 py-1 text-xs font-medium bg-gradient-to-r from-purple-100 to-pink-100 text-purple-800 rounded-full whitespace-nowrap">
                        평생
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:gap-4">
                <div className="flex items-center min-w-0">
                  <FiMail className="w-4 h-4 text-gray-500 mr-2 flex-shrink-0" />
                  <span className="text-sm text-gray-600 truncate">{member.email}</span>
                </div>
                {member.phone_number && (
                  <div className="flex items-center min-w-0">
                    <FiPhone className="w-4 h-4 text-gray-500 mr-2 flex-shrink-0" />
                    <span className="text-sm text-gray-600 truncate">{member.phone_number}</span>
                  </div>
                )}
                {member.real_name && (
                  <div className="flex items-center min-w-0">
                    <FiUser className="w-4 h-4 text-gray-500 mr-2 flex-shrink-0" />
                    <span className="text-sm text-gray-600 truncate">실명: {member.real_name}</span>
                  </div>
                )}
              </div>
            </div>

            {/* 가입 정보 */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-2 sm:mb-3">가입 정보</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div className="flex items-start min-w-0">
                  <FiCalendar className="w-4 h-4 text-gray-500 mr-2 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs sm:text-sm text-gray-600">가입일</p>
                    <p className="text-sm font-medium text-gray-900 break-words">
                      {formatDate(member.created_at)}
                    </p>
                  </div>
                </div>
                <div className="flex items-start min-w-0">
                  <FiCalendar className="w-4 h-4 text-gray-500 mr-2 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs sm:text-sm text-gray-600">최종 업데이트</p>
                    <p className="text-sm font-medium text-gray-900 break-words">
                      {formatDate(member.updated_at)}
                    </p>
                  </div>
                </div>
                {member.last_login_at && (
                  <div className="flex items-start min-w-0 sm:col-span-2">
                    <FiCalendar className="w-4 h-4 text-gray-500 mr-2 mt-0.5 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs sm:text-sm text-gray-600">최근 로그인</p>
                      <p className="text-sm font-medium text-gray-900 break-words">
                        {formatDate(member.last_login_at)}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 새로운 맅버 상태 정보 */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-2 sm:mb-3">맅버 상태</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div className="flex items-center">
                  <FiUser className="w-4 h-4 text-gray-500 mr-2" />
                  <div>
                    <p className="text-sm text-gray-600">프로필 완성도</p>
                    <p className="text-sm font-medium text-gray-900">
                      {member.profile_completeness_score}%
                    </p>
                  </div>
                </div>
                <div className="flex items-center">
                  <FiUser className="w-4 h-4 text-gray-500 mr-2" />
                  <div>
                    <p className="text-sm text-gray-600">참여도 점수</p>
                    <p className="text-sm font-medium text-gray-900">{member.engagement_score}점</p>
                  </div>
                </div>
                <div className="flex items-center">
                  <FiShield className="w-4 h-4 text-gray-500 mr-2" />
                  <div>
                    <p className="text-sm text-gray-600">맅버십 타입</p>
                    <p className="text-sm font-medium text-gray-900">
                      {member.membership_type === 'regular' && '일반'}
                      {member.membership_type === 'premium' && '프리미엄'}
                      {member.membership_type === 'lifetime' && '평생'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* 인증 상태 */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-2 sm:mb-3">인증 상태</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                <div className="flex items-center">
                  <FiMail className="w-4 h-4 text-gray-500 mr-2" />
                  <div>
                    <p className="text-sm text-gray-600">이메일 인증</p>
                    <p
                      className={`text-sm font-medium ${
                        member.verification_status.email ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      {member.verification_status.email ? '완료' : '미인증'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center">
                  <FiPhone className="w-4 h-4 text-gray-500 mr-2" />
                  <div>
                    <p className="text-sm text-gray-600">전화번호 인증</p>
                    <p
                      className={`text-sm font-medium ${
                        member.verification_status.phone ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      {member.verification_status.phone ? '완료' : '미인증'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center">
                  <FiShield className="w-4 h-4 text-gray-500 mr-2" />
                  <div>
                    <p className="text-sm text-gray-600">신원 인증</p>
                    <p
                      className={`text-sm font-medium ${
                        member.verification_status.identity ? 'text-green-600' : 'text-red-600'
                      }`}
                    >
                      {member.verification_status.identity ? '완료' : '미인증'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* 정지 상태 */}
            {member.is_suspended && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <h4 className="text-sm font-medium text-red-900 mb-2">정지 상태</h4>
                <div className="space-y-2">
                  <p className="text-sm text-red-700">
                    정지 사유: {member.suspension_reason || '사유 없음'}
                  </p>
                  {member.suspension_until && (
                    <p className="text-sm text-red-700">
                      정지 기간: {formatDate(member.suspension_until)}까지
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* 결제 정보 */}
            {(member.monthly_fee || member.bank_name || member.account_number) && (
              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-2 sm:mb-3">결제 정보</h4>
                <div className="grid grid-cols-1 gap-4">
                  {member.monthly_fee && (
                    <div className="flex items-center">
                      <FiDollarSign className="w-4 h-4 text-gray-500 mr-2" />
                      <div>
                        <p className="text-sm text-gray-600">월 조합비</p>
                        <p className="text-sm font-medium text-gray-900">
                          {formatCurrency(member.monthly_fee)}
                        </p>
                      </div>
                    </div>
                  )}
                  {member.bank_name && (
                    <div className="flex items-center">
                      <FiCreditCard className="w-4 h-4 text-gray-500 mr-2" />
                      <div>
                        <p className="text-sm text-gray-600">계좌 정보</p>
                        <p className="text-sm font-medium text-gray-900">
                          {member.bank_name} {member.account_number}
                          {member.account_holder && ` (${member.account_holder})`}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 권한 정보 */}
            <div>
              <h4 className="text-sm font-medium text-gray-900 mb-2 sm:mb-3">권한 정보</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div className="flex items-center">
                  <FiShield className="w-4 h-4 text-gray-500 mr-2" />
                  <span className="text-sm text-gray-600">
                    관리자 권한: {member.is_admin ? '있음' : '없음'}
                  </span>
                </div>
                <div className="flex items-center">
                  <FiMusic className="w-4 h-4 text-gray-500 mr-2" />
                  <span className="text-sm text-gray-600">
                    아티스트 권한: {member.is_artist ? '있음' : '없음'}
                  </span>
                </div>
                {member.artist_id && (
                  <div className="flex items-center col-span-2">
                    <FiMusic className="w-4 h-4 text-gray-500 mr-2" />
                    <span className="text-sm text-gray-600">
                      연결된 아티스트 ID: {member.artist_id}
                    </span>
                  </div>
                )}
                {/* 이사 지정 토글 */}
                {onFlagsUpdate && (
                  <div className="col-span-2 border-t border-gray-100 pt-3 mt-1">
                    <div className="flex items-center gap-3">
                      <FiShield className="w-4 h-4 text-teal-500 flex-shrink-0" />
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={directorChecked}
                          onChange={e => handleDirectorToggle(e.target.checked)}
                          disabled={flagsLoading || isLoading}
                          className="rounded border-gray-300 text-teal-600 focus:ring-teal-500"
                        />
                        <span className="text-sm text-gray-700 font-medium">이사</span>
                      </label>
                      {directorChecked && (
                        <div className="flex items-center gap-2 flex-1">
                          <input
                            type="text"
                            value={directorTitle}
                            onChange={e => setDirectorTitle(e.target.value)}
                            onBlur={handleDirectorTitleSave}
                            placeholder="직책"
                            disabled={flagsLoading || isLoading}
                            className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50"
                          />
                        </div>
                      )}
                      {flagsLoading && (
                        <div className="w-4 h-4 border-2 border-teal-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 액션 버튼 */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3 p-4 sm:p-6 border-t border-gray-200 flex-shrink-0">
          {member.registration_status === 'pending' && (
            <>
              <button
                onClick={() => handleAction('approve')}
                disabled={isLoading}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 flex items-center justify-center text-sm sm:text-base"
              >
                <FiCheck className="w-4 h-4 mr-2" />
                승인
              </button>
              <button
                onClick={() => handleAction('reject')}
                disabled={isLoading}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 flex items-center justify-center text-sm sm:text-base"
              >
                <FiX className="w-4 h-4 mr-2" />
                거부
              </button>
            </>
          )}

          {member.registration_status === 'approved' && (
            <>
              <button
                onClick={() => handleAction(member.is_active ? 'deactivate' : 'activate')}
                disabled={isLoading}
                className={`px-4 py-2 rounded-md disabled:opacity-50 flex items-center justify-center text-sm sm:text-base ${
                  member.is_active
                    ? 'bg-orange-600 text-white hover:bg-orange-700'
                    : 'bg-green-600 text-white hover:bg-green-700'
                }`}
              >
                {member.is_active ? (
                  <FiPause className="w-4 h-4 mr-2" />
                ) : (
                  <FiPlay className="w-4 h-4 mr-2" />
                )}
                {member.is_active ? '비활성화' : '활성화'}
              </button>

              <button
                onClick={() => handleAction(member.is_suspended ? 'unsuspend' : 'suspend')}
                disabled={isLoading}
                className={`px-4 py-2 rounded-md disabled:opacity-50 flex items-center justify-center text-sm sm:text-base ${
                  member.is_suspended
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-red-600 text-white hover:bg-red-700'
                }`}
              >
                <FiShield className="w-4 h-4 mr-2" />
                {member.is_suspended ? '정지해제' : '정지'}
              </button>
            </>
          )}

          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 text-sm sm:text-base"
          >
            닫기
          </button>
        </div>
      </div>

      {/* 확인 모달 */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-60">
          <div className="bg-white rounded-lg shadow-xl max-w-xs sm:max-w-md w-full mx-4">
            <div className="p-6">
              <div className="flex items-center mb-4">
                <FiAlertCircle className="w-6 h-6 text-yellow-500 mr-3" />
                <h3 className="text-lg font-semibold text-gray-900">확인</h3>
              </div>
              <p className="text-gray-600 mb-6">
                {member.display_name}님을 {confirmAction.title}하시겠습니까?
              </p>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setConfirmAction(null)}
                  className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
                >
                  취소
                </button>
                <button
                  onClick={confirmActionHandler}
                  disabled={isLoading}
                  className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
                >
                  {isLoading ? '처리 중...' : '확인'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
