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

      const data = await response.json()

      if (data.success) {
        setSettings(data.settings)
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
