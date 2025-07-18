import { Metadata } from 'next'
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
    <PermissionCheck requiredPermission="member">
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
            icon={<FiActivity className="w-8 h-8 text-gray-600" />}
            href="/mypage/activity"
            buttonText="활동 보기"
            disabled
            badge="준비중"
          />

          {/* 설정 */}
          <DashboardCard
            title="설정"
            description="알림 및 기타 설정을 관리하세요."
            icon={<FiSettings className="w-8 h-8 text-gray-600" />}
            href="/mypage/settings"
            buttonText="설정"
            disabled
            badge="준비중"
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