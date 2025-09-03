'use client'

// 정적 생성 방지 - 인증이 필요한 동적 페이지
export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase/client'

export default function PendingPage() {
  const [userEmail, setUserEmail] = useState<string>('')
  const [emailVerified, setEmailVerified] = useState<boolean | null>(null)
  const [checkingStatus, setCheckingStatus] = useState(false)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)

  useEffect(() => {
    // 현재 사용자 정보 가져오기
    const getCurrentUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) {
        setUserEmail(user.email || '')
        setEmailVerified(!!user.email_confirmed_at)
      }
    }

    getCurrentUser()
  }, [])

  const checkApprovalStatus = async () => {
    setCheckingStatus(true)
    setLastChecked(new Date())

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        alert('로그인이 필요합니다.')
        return
      }

      // 이메일 인증 상태 업데이트
      setEmailVerified(!!user.email_confirmed_at)

      if (!user.email_confirmed_at) {
        alert(
          '먼저 이메일 인증을 완료해주세요. 가입 시 등록한 이메일함을 확인하고 인증 링크를 클릭해주세요.'
        )
        return
      }

      const { data: profile, error } = await supabase
        .from('member_profiles')
        .select('registration_status, is_active')
        .eq('id', user.id)
        .single()

      if (error) {
        console.error('프로필 확인 오류:', error)
        alert('상태 확인 중 오류가 발생했습니다.')
        return
      }

      if ((profile as any)?.registration_status === 'approved' && (profile as any)?.is_active) {
        alert('🎉 축하합니다! 조합원 승인이 완료되었습니다. 게시판으로 이동합니다.')
        window.location.href = '/board'
      } else if ((profile as any)?.registration_status === 'rejected') {
        alert('😔 죄송합니다. 가입 신청이 거절되었습니다. 자세한 사항은 관리자에게 문의해주세요.')
      } else {
        alert('이메일 인증이 완료되었습니다! 관리자 승인을 기다려주세요.')
      }
    } catch (error) {
      console.error('상태 확인 오류:', error)
      alert('상태 확인 중 오류가 발생했습니다.')
    } finally {
      setCheckingStatus(false)
    }
  }

  const formatLastChecked = (date: Date) => {
    return date.toLocaleString('ko-KR', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 pt-24 md:pt-28 pb-12 px-4 sm:px-6 lg:px-8 flex items-center justify-center">
      <div className="max-w-lg w-full space-y-8">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 flex items-center justify-center rounded-full bg-yellow-100 mb-4">
            <svg
              className="h-6 w-6 text-yellow-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h2 className="text-3xl font-extrabold text-gray-900">승인 대기 중</h2>
          <p className="mt-2 text-sm text-gray-600">조합원 정보가 성공적으로 제출되었습니다.</p>
          {userEmail && <p className="mt-1 text-xs text-gray-500">등록 이메일: {userEmail}</p>}
        </div>

        <div className="space-y-4">
          {/* 단계별 프로세스 */}
          <div className="p-4 rounded-md bg-blue-50 border border-blue-200">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M9 3a1 1 0 012 0v5.5a.5.5 0 001 0V4a1 1 0 112 0v4.5a.5.5 0 001 0V6a1 1 0 112 0v6a6 6 0 01-6 6H9a6 6 0 01-6-6V9a1 1 0 012 0v3a.5.5 0 001 0V9a1 1 0 012 0v.5a.5.5 0 001 0V3z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="ml-3 text-blue-700">
                <h3 className="text-sm font-medium">조합원 가입 진행 단계</h3>
                <div className="mt-2 text-sm space-y-2">
                  <div className="flex items-center">
                    <span className="text-green-500 font-bold">✅</span>
                    <span className="ml-2">1단계: 조합원 정보 입력 완료</span>
                  </div>
                  <div className="flex items-center">
                    <span
                      className={
                        emailVerified ? 'text-green-500 font-bold' : 'text-amber-500 font-bold'
                      }
                    >
                      {emailVerified ? '✅' : '⏳'}
                    </span>
                    <span className="ml-2">
                      2단계: 이메일 인증 {emailVerified ? '완료' : '필요'}
                    </span>
                  </div>
                  <div className="flex items-center">
                    <span className="text-gray-400 font-bold">⏸️</span>
                    <span className="ml-2 text-gray-600">3단계: 관리자 승인 대기</span>
                  </div>
                  <div className="flex items-center">
                    <span className="text-gray-400 font-bold">🎯</span>
                    <span className="ml-2 text-gray-600">4단계: 게시판 이용 가능</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 이메일 미인증 상태 전용 안내 */}
          {emailVerified === false && (
            <div className="p-4 rounded-md bg-red-50 border border-red-200">
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <div className="ml-3 text-red-700">
                  <h3 className="text-sm font-medium">🚨 이메일 인증이 필요합니다</h3>
                  <div className="mt-2 text-sm space-y-1">
                    <p>
                      <strong>• 관리자 승인을 받으려면 먼저 이메일 인증을 완료해야 합니다</strong>
                    </p>
                    <p>
                      • 등록한 이메일:{' '}
                      <span className="font-mono text-xs bg-red-100 px-1 rounded">{userEmail}</span>
                    </p>
                    <p>
                      • 가입 시 발송된 <strong>"이메일 인증 링크"</strong>를 클릭해주세요
                    </p>
                    <p>
                      • 이메일이 오지 않았다면 <strong>스팸함</strong>을 확인해주세요
                    </p>
                    <p>• 인증 완료 후 아래 "상태 확인" 버튼을 눌러주세요</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 이메일 인증 완료 후 관리자 승인 대기 안내 */}
          {emailVerified === true && (
            <div className="p-4 rounded-md bg-green-50 border border-green-200">
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
                <div className="ml-3 text-green-700">
                  <h3 className="text-sm font-medium">✅ 이메일 인증 완료!</h3>
                  <div className="mt-2 text-sm space-y-1">
                    <p>
                      <strong>• 이메일 인증이 완료되었습니다</strong>
                    </p>
                    <p>• 이제 관리자가 조합원 승인을 진행할 수 있습니다</p>
                    <p>• 승인 과정은 보통 1-3일 소요됩니다</p>
                    <p>• 승인 완료 시 별도 알림을 받게 됩니다</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col space-y-3">
          <button
            onClick={checkApprovalStatus}
            disabled={checkingStatus}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {checkingStatus
              ? '확인 중...'
              : emailVerified === false
                ? '이메일 인증 상태 확인'
                : '관리자 승인 상태 확인'}
          </button>

          {lastChecked && (
            <p className="text-xs text-gray-500 text-center">
              마지막 확인: {formatLastChecked(lastChecked)}
            </p>
          )}
        </div>

        <div className="border-t border-gray-200 pt-6">
          <div className="text-center text-sm text-gray-600">
            <p className="mb-2">승인 지연 시 또는 궁금한 점이 있으시면:</p>
            <div className="space-y-2">
              <div className="space-x-4">
                <Link
                  href="/connect"
                  className="font-medium text-primary-600 hover:text-primary-500"
                >
                  문의하기
                </Link>
                <span className="text-gray-300">|</span>
                <Link href="/" className="font-medium text-primary-600 hover:text-primary-500">
                  홈으로 돌아가기
                </Link>
              </div>
              <p className="text-xs text-gray-500">
                또는 경기아트콜렉티브 SNS 채널을 통해 문의하실 수 있습니다
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
