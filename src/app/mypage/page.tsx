import { Metadata } from 'next'
import Link from 'next/link'
import { FiUser, FiSettings, FiMusic, FiActivity } from 'react-icons/fi'
import MypageLayout from './components/MypageLayout'
import DashboardCard from './components/DashboardCard'
import PermissionCheck from './components/PermissionCheck'

export const metadata: Metadata = {
  title: '마이페이지 | 경기아트콜렉티브',
  description: '개인 프로필 및 아티스트 정보를 관리하세요.',
  robots: {
    index: false,
    follow: false,
  },
}

export default function MypagePage() {
  return (
    <PermissionCheck 
      requiredPermission="member"
      fallback={
        <MypageLayout 
          title="마이페이지" 
          description="조합원 승인 상태를 확인해주세요."
        >
          <div className="text-center py-12">
            <div className="mx-auto h-16 w-16 flex items-center justify-center rounded-full bg-amber-100 mb-6">
              <svg className="h-8 w-8 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-4">
              승인 대기 중
            </h2>
            <p className="text-gray-600 mb-6 max-w-md mx-auto">
              조합원 승인이 완료되면 마이페이지의 모든 기능을 이용하실 수 있습니다.
            </p>
            <div className="space-y-3">
              <a
                href="/register/pending"
                className="inline-block bg-primary-600 hover:bg-primary-700 text-white font-medium py-3 px-6 rounded-lg transition-colors"
              >
                승인 상태 확인하기
              </a>
              <div>
                <Link
                  href="/"
                  className="text-gray-500 hover:text-gray-700 text-sm underline"
                >
                  홈으로 돌아가기
                </Link>
              </div>
            </div>
          </div>
        </MypageLayout>
      }
    >
      <MypageLayout 
        title="마이페이지" 
        description="개인 정보와 아티스트 프로필을 관리하세요."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* 개인 프로필 관리 */}
          <DashboardCard
            title="개인 프로필"
            description="기본 정보 및 조합 관련 정보를 수정하세요."
            icon={<FiUser className="w-8 h-8 text-primary-600" />}
            href="/mypage/profile"
            buttonText="프로필 편집"
          />

          {/* 아티스트 프로필 관리 (권한 있는 사용자만) */}
          <PermissionCheck 
            requiredPermission="artist"
            fallback={
              <DashboardCard
                title="아티스트 프로필"
                description="아티스트 권한이 필요합니다."
                icon={<FiMusic className="w-8 h-8 text-gray-400" />}
                disabled
              />
            }
          >
            <DashboardCard
              title="아티스트 프로필"
              description="아티스트 페이지 정보를 관리하세요."
              icon={<FiMusic className="w-8 h-8 text-accent-600" />}
              href="/mypage/artist"
              buttonText="아티스트 관리"
            />
          </PermissionCheck>

          {/* 활동 로그 */}
          <DashboardCard
            title="활동 내역"
            description="최근 활동 및 변경 이력을 확인하세요."
            icon={<FiActivity className="w-8 h-8 text-green-600" />}
            href="/mypage/activity"
            buttonText="활동 보기"
          />

          {/* 설정 */}
          <DashboardCard
            title="설정"
            description="알림 및 기타 설정을 관리하세요."
            icon={<FiSettings className="w-8 h-8 text-blue-600" />}
            href="/mypage/settings"
            buttonText="설정"
          />
        </div>

        {/* 빠른 정보 */}
        <div className="mt-8 bg-gradient-to-r from-primary-50 to-accent-50 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            💡 도움말
          </h3>
          <div className="text-sm text-gray-600 space-y-2">
            <p>• <strong>개인 프로필</strong>: 기본 정보, 조합비, 계좌 정보를 수정할 수 있습니다.</p>
            <p>• <strong>아티스트 프로필</strong>: 아티스트 권한이 있는 경우 공개 프로필을 관리할 수 있습니다.</p>
            <p>• 문제가 있으시면 관리자에게 연락해 주세요.</p>
          </div>
        </div>
      </MypageLayout>
    </PermissionCheck>
  )
}