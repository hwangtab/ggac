'use client'

import { useState, useEffect } from 'react'
import MypageLayout from '../components/MypageLayout'
import PermissionCheck from '../components/PermissionCheck'
import SettingsSection from './components/SettingsSection'
import NotificationSettings from './components/NotificationSettings'
import PrivacySettings from './components/PrivacySettings'
import InterfaceSettings from './components/InterfaceSettings'
import SecuritySettings from './components/SecuritySettings'
import PreferenceSettings from './components/PreferenceSettings'
import { FiSettings, FiBell, FiShield, FiMonitor, FiLock, FiUser } from 'react-icons/fi'
import type { SettingCategory, SettingWithDefault } from '@/types/index'
import { fetchSessionProfile, refreshSessionProfile } from '@/utils/sessionProfile'

interface SettingsTab {
  id: SettingCategory
  label: string
  icon: React.ComponentType<{ className?: string }>
  component: React.ComponentType<{
    settings: SettingWithDefault[]
    onUpdate: (category: SettingCategory, key: string, value: any) => Promise<void>
  }>
}

export default function MypageSettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingCategory>('notification')
  const [settings, setSettings] = useState<Record<SettingCategory, SettingWithDefault[]>>({
    notification: [],
    privacy: [],
    interface: [],
    security: [],
    preference: [],
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  // 탈퇴 신청·취소 영역 상태. 설정 탭 데이터와는 별개로 세션 프로필에서 온다.
  //
  // `registration_status`는 신청 중에도 'approved'로 남는다(0011 참조) —
  // 그래서 신청 여부는 별도 타임스탬프로 든다. `null`이면 미신청, 값이 있으면
  // 신청 중이다.
  const [withdrawalRequestedAt, setWithdrawalRequestedAt] = useState<string | null>(null)
  const [withdrawalSubmitting, setWithdrawalSubmitting] = useState(false)

  const tabs: SettingsTab[] = [
    {
      id: 'notification',
      label: '알림 설정',
      icon: FiBell,
      component: NotificationSettings,
    },
    {
      id: 'privacy',
      label: '개인정보',
      icon: FiUser,
      component: PrivacySettings,
    },
    {
      id: 'interface',
      label: '인터페이스',
      icon: FiMonitor,
      component: InterfaceSettings,
    },
    {
      id: 'security',
      label: '보안',
      icon: FiLock,
      component: SecuritySettings,
    },
    {
      id: 'preference',
      label: '취향 설정',
      icon: FiShield,
      component: PreferenceSettings,
    },
  ]

  // 설정 조회
  const fetchSettings = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/settings')

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      // 표준 응답 래퍼: { success, data: { settings, total } }
      const data = await response.json()

      if (data.success) {
        setSettings(data.data.settings)
      } else {
        console.error('Failed to fetch settings:', data.error)
      }
    } catch (error) {
      console.error('Settings fetch error:', error)
    } finally {
      setLoading(false)
    }
  }

  // 설정 업데이트
  const updateSetting = async (
    category: SettingCategory,
    setting_key: string,
    setting_value: any
  ) => {
    try {
      setSaving(`${category}.${setting_key}`)

      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          category,
          setting_key,
          setting_value,
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()

      if (data.success) {
        // 로컬 상태 업데이트
        setSettings(prev => ({
          ...prev,
          [category]: prev[category].map(setting =>
            setting.setting_key === setting_key
              ? { ...setting, setting_value, is_default: false }
              : setting
          ),
        }))
      } else {
        throw new Error(data.error || 'Failed to update setting')
      }
    } catch (error) {
      console.error('Setting update error:', error)
      alert('설정 업데이트에 실패했습니다.')
    } finally {
      setSaving(null)
    }
  }

  useEffect(() => {
    fetchSettings()
  }, [])

  useEffect(() => {
    fetchSessionProfile().then(session => {
      setWithdrawalRequestedAt(session.profile?.withdrawal_requested_at ?? null)
    })
  }, [])

  // 탈퇴 신청. `fetch`는 네트워크가 끊기면 reject하므로 try/finally 없이
  // 제출 상태를 관리하면 버튼이 영구히 잠긴다(EditPageClient.tsx가 겪은 버그).
  const handleWithdrawalRequest = async () => {
    if (withdrawalSubmitting) return
    if (
      !confirm(
        '탈퇴를 신청하시겠습니까? 관리자 확인 후 처리되며, 확인 전까지는 신청을 취소할 수 있습니다.'
      )
    ) {
      return
    }
    setWithdrawalSubmitting(true)
    try {
      const response = await fetch('/api/mypage/withdrawal', { method: 'POST' })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        alert(result?.error || '탈퇴 신청에 실패했습니다.')
        return
      }
      // 서버는 정확한 타임스탬프를 응답에 싣지 않는다(경합 시 실제로 쓰인
      // 값과 다를 수 있어서) — 강제 재조회로 권위 있는 값을 가져온다.
      const session = await refreshSessionProfile()
      setWithdrawalRequestedAt(session.profile?.withdrawal_requested_at ?? null)
      alert(result.message || '탈퇴 신청이 접수되었습니다.')
    } catch {
      alert('네트워크 오류로 신청하지 못했습니다. 연결을 확인하고 다시 시도해주세요.')
    } finally {
      setWithdrawalSubmitting(false)
    }
  }

  // 탈퇴 신청 취소.
  const handleWithdrawalCancel = async () => {
    if (withdrawalSubmitting) return
    setWithdrawalSubmitting(true)
    try {
      const response = await fetch('/api/mypage/withdrawal', { method: 'DELETE' })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        alert(result?.error || '탈퇴 신청 취소에 실패했습니다.')
        return
      }
      const session = await refreshSessionProfile()
      setWithdrawalRequestedAt(session.profile?.withdrawal_requested_at ?? null)
      alert(result.message || '탈퇴 신청을 취소했습니다.')
    } catch {
      alert('네트워크 오류로 취소하지 못했습니다. 연결을 확인하고 다시 시도해주세요.')
    } finally {
      setWithdrawalSubmitting(false)
    }
  }

  const ActiveComponent = tabs.find(tab => tab.id === activeTab)?.component

  return (
    <PermissionCheck requiredPermission="member" redirectTo="/register/pending">
      <MypageLayout title="설정" description="개인 설정을 관리합니다.">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {/* 탭 네비게이션 */}
          <div className="border-b border-gray-200">
            <nav className="flex space-x-8 px-6" aria-label="Tabs">
              {tabs.map(tab => {
                const IconComponent = tab.icon
                const isActive = activeTab === tab.id

                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`${
                      isActive
                        ? 'border-primary-500 text-primary-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center transition-colors`}
                  >
                    <IconComponent className="w-4 h-4 mr-2" />
                    {tab.label}
                  </button>
                )
              })}
            </nav>
          </div>

          {/* 설정 내용 */}
          <div className="p-6">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                <span className="ml-3 text-gray-600">설정을 불러오는 중...</span>
              </div>
            ) : ActiveComponent ? (
              <SettingsSection
                title={tabs.find(tab => tab.id === activeTab)?.label || ''}
                description={getTabDescription(activeTab)}
              >
                <ActiveComponent settings={settings[activeTab] || []} onUpdate={updateSetting} />
              </SettingsSection>
            ) : (
              <div className="text-center py-12">
                <FiSettings className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">설정을 선택해 주세요</h3>
                <p className="text-gray-600">왼쪽 탭에서 원하는 설정 카테고리를 선택하세요.</p>
              </div>
            )}
          </div>

          {/* 저장 상태 표시 */}
          {saving && (
            <div className="fixed bottom-4 right-4 bg-primary-600 text-white px-4 py-2 rounded-lg shadow-lg flex items-center">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              저장 중...
            </div>
          )}
        </div>

        {/* 탈퇴는 되돌릴 수 없으므로 무엇이 사라지고 무엇이 남는지 미리 밝힌다. */}
        <section className="mt-12 border-t border-gray-200 pt-8">
          <h2 className="text-lg font-semibold text-gray-900">조합 탈퇴</h2>
          <p className="mt-2 text-sm text-gray-600">
            탈퇴를 신청하면 관리자 확인 후 처리됩니다. 확인 전까지는 신청을 취소할 수 있습니다.
          </p>
          <ul className="mt-3 list-disc pl-5 text-sm text-gray-600 space-y-1">
            <li>이름·연락처·생년월일·계좌 정보는 삭제됩니다.</li>
            <li>작성하신 글과 댓글은 남고, 작성자만 &lsquo;탈퇴한 조합원&rsquo;으로 바뀝니다.</li>
            <li>조합비 납부 기록은 법령에 따라 보존됩니다.</li>
            <li>자동결제가 등록되어 있으면 해지됩니다.</li>
          </ul>
          {/* 신청/취소 버튼 — registration_status는 신청 중에도 'approved'로
              남으므로(0011 참조) withdrawalRequestedAt으로 하나만 고른다 */}
          <div className="mt-4">
            {!withdrawalRequestedAt && (
              <button
                type="button"
                onClick={handleWithdrawalRequest}
                disabled={withdrawalSubmitting}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50 text-sm"
              >
                {withdrawalSubmitting ? '처리 중...' : '탈퇴 신청'}
              </button>
            )}
            {withdrawalRequestedAt && (
              <div className="space-y-2">
                <p className="text-sm text-amber-700">
                  탈퇴 신청이 접수되어 관리자 확인을 기다리고 있습니다.
                </p>
                <button
                  type="button"
                  onClick={handleWithdrawalCancel}
                  disabled={withdrawalSubmitting}
                  className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:opacity-50 text-sm"
                >
                  {withdrawalSubmitting ? '처리 중...' : '탈퇴 신청 취소'}
                </button>
              </div>
            )}
          </div>
        </section>
      </MypageLayout>
    </PermissionCheck>
  )
}

function getTabDescription(category: SettingCategory): string {
  switch (category) {
    case 'notification':
      return '알림 수신 방법과 빈도를 설정합니다.'
    case 'privacy':
      return '개인정보 공개 범위와 프라이버시를 설정합니다.'
    case 'interface':
      return '화면 표시 방식과 사용자 인터페이스를 설정합니다.'
    case 'security':
      return '계정 보안과 로그인 관련 설정을 관리합니다.'
    case 'preference':
      return '콘텐츠 필터링과 개인 취향을 설정합니다.'
    default:
      return ''
  }
}
