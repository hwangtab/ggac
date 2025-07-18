'use client'

import MypageLayout from '../components/MypageLayout'
import { FiSettings, FiBell, FiUser, FiLock, FiMonitor } from 'react-icons/fi'

export default function SettingsPage() {
  return (
    <MypageLayout>
      <div className="max-w-4xl mx-auto">
        {/* 헤더 */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">설정</h1>
          <p className="text-gray-600">
            계정 및 시스템 설정을 관리하세요.
          </p>
        </div>

        {/* 준비중 메시지 */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-8">
          <div className="flex items-start">
            <FiSettings className="w-6 h-6 text-blue-600 mt-1" />
            <div className="ml-3">
              <h3 className="text-lg font-semibold text-blue-900 mb-2">
                설정 기능 준비 중
              </h3>
              <p className="text-blue-800 mb-4">
                더 나은 사용자 경험을 위해 설정 기능을 개발 중입니다. 
                곧 다양한 설정 옵션을 제공할 예정입니다.
              </p>
              <div className="text-sm text-blue-700">
                예정된 기능들:
              </div>
            </div>
          </div>
        </div>

        {/* 예정된 기능들 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 알림 설정 */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <div className="flex items-center mb-4">
              <FiBell className="w-5 h-5 text-gray-600 mr-3" />
              <h3 className="text-lg font-semibold text-gray-900">알림 설정</h3>
              <span className="ml-auto bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded-full">
                준비중
              </span>
            </div>
            <p className="text-gray-600 text-sm">
              이메일 알림, 푸시 알림 등 다양한 알림 설정을 관리할 수 있습니다.
            </p>
            <ul className="mt-3 text-sm text-gray-500 space-y-1">
              <li>• 새 게시글 알림</li>
              <li>• 댓글 알림</li>
              <li>• 공지사항 알림</li>
              <li>• 이메일 구독 설정</li>
            </ul>
          </div>

          {/* 개인정보 설정 */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <div className="flex items-center mb-4">
              <FiUser className="w-5 h-5 text-gray-600 mr-3" />
              <h3 className="text-lg font-semibold text-gray-900">개인정보 설정</h3>
              <span className="ml-auto bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded-full">
                준비중
              </span>
            </div>
            <p className="text-gray-600 text-sm">
              프로필 공개 범위, 개인정보 보호 설정 등을 관리할 수 있습니다.
            </p>
            <ul className="mt-3 text-sm text-gray-500 space-y-1">
              <li>• 프로필 공개 설정</li>
              <li>• 연락처 공개 범위</li>
              <li>• 활동 내역 표시</li>
              <li>• 데이터 다운로드</li>
            </ul>
          </div>

          {/* 보안 설정 */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <div className="flex items-center mb-4">
              <FiLock className="w-5 h-5 text-gray-600 mr-3" />
              <h3 className="text-lg font-semibold text-gray-900">보안 설정</h3>
              <span className="ml-auto bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded-full">
                준비중
              </span>
            </div>
            <p className="text-gray-600 text-sm">
              비밀번호 변경, 2단계 인증 등 계정 보안을 강화할 수 있습니다.
            </p>
            <ul className="mt-3 text-sm text-gray-500 space-y-1">
              <li>• 비밀번호 변경</li>
              <li>• 2단계 인증 설정</li>
              <li>• 로그인 기록 확인</li>
              <li>• 계정 연결 관리</li>
            </ul>
          </div>

          {/* 화면 설정 */}
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <div className="flex items-center mb-4">
              <FiMonitor className="w-5 h-5 text-gray-600 mr-3" />
              <h3 className="text-lg font-semibold text-gray-900">화면 설정</h3>
              <span className="ml-auto bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded-full">
                준비중
              </span>
            </div>
            <p className="text-gray-600 text-sm">
              테마, 언어, 접근성 등 화면 표시 관련 설정을 관리할 수 있습니다.
            </p>
            <ul className="mt-3 text-sm text-gray-500 space-y-1">
              <li>• 다크 모드 설정</li>
              <li>• 언어 설정</li>
              <li>• 폰트 크기 조정</li>
              <li>• 애니메이션 설정</li>
            </ul>
          </div>
        </div>

        {/* 임시 안내 */}
        <div className="mt-8 bg-gray-50 border border-gray-200 rounded-lg p-6">
          <h4 className="text-md font-semibold text-gray-900 mb-2">
            현재 이용 가능한 설정
          </h4>
          <p className="text-gray-600 text-sm mb-4">
            지금은 다른 메뉴에서 일부 설정을 변경할 수 있습니다:
          </p>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-gray-700">• 개인 정보 수정</span>
              <a 
                href="/mypage/profile" 
                className="text-primary-600 hover:text-primary-700 underline"
              >
                프로필 설정으로 이동
              </a>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-700">• 아티스트 정보 관리</span>
              <a 
                href="/mypage/artist" 
                className="text-primary-600 hover:text-primary-700 underline"
              >
                아티스트 설정으로 이동
              </a>
            </div>
          </div>
        </div>

        {/* 문의하기 */}
        <div className="mt-6 text-center">
          <p className="text-gray-500 text-sm">
            필요한 설정이 있거나 문의사항이 있으시면{' '}
            <a 
              href="/connect" 
              className="text-primary-600 hover:text-primary-700 underline"
            >
              문의하기
            </a>
            를 통해 연락주세요.
          </p>
        </div>
      </div>
    </MypageLayout>
  )
}