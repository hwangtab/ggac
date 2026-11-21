'use client'

import Switch from '@/components/common/Switch'
import { useState } from 'react'
import type { SettingWithDefault, SettingCategory } from '@/types/index'

interface PrivacySettingsProps {
  settings: SettingWithDefault[]
  onUpdate: (category: SettingCategory, key: string, value: any) => Promise<void>
}

export default function PrivacySettings({ settings, onUpdate }: PrivacySettingsProps) {
  const [updating, setUpdating] = useState<string | null>(null)

  const getSetting = (key: string) => {
    return settings.find(s => s.setting_key === key)?.setting_value || {}
  }

  const updateSettingValue = async (key: string, value: any) => {
    setUpdating(key)
    try {
      await onUpdate('privacy', key, value)
    } finally {
      setUpdating(null)
    }
  }

  const profileVisibility = getSetting('profile_visibility')
  const activityVisibility = getSetting('activity_visibility')
  const contactVisibility = getSetting('contact_visibility')

  return (
    <div className="space-y-8">
      {/* 프로필 공개 범위 */}
      <div className="bg-gray-50 rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">프로필 공개 범위</h3>
        <div className="space-y-3">
          {profileVisibility.options?.map((option: string) => (
            <div key={option} className="flex items-center">
              <input
                id={`profile-${option}`}
                name="profile-visibility"
                type="radio"
                disabled={updating === 'profile_visibility'}
                checked={profileVisibility.level === option}
                onChange={() =>
                  updateSettingValue('profile_visibility', {
                    ...profileVisibility,
                    level: option,
                  })
                }
                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 disabled:opacity-50"
              />
              <label htmlFor={`profile-${option}`} className="ml-3 text-sm">
                <span className="font-medium text-gray-700">{getVisibilityLabel(option)}</span>
                <p className="text-gray-500">{getVisibilityDescription(option)}</p>
              </label>
            </div>
          ))}
        </div>
      </div>

      {/* 활동 내역 공개 설정 */}
      <div className="bg-gray-50 rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">활동 내역 공개</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-700">활동 내역 표시</label>
              <p className="text-sm text-gray-500">다른 사용자에게 내 활동 내역을 표시합니다</p>
            </div>
            <Switch
              checked={!!activityVisibility.show_activity}
              label="활동 내역 표시"
              disabled={updating === 'activity_visibility'}
              onCheckedChange={() =>
                updateSettingValue('activity_visibility', {
                  ...activityVisibility,
                  show_activity: !activityVisibility.show_activity,
                })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-700">마지막 접속 시간 표시</label>
              <p className="text-sm text-gray-500">
                마지막으로 접속한 시간을 다른 사용자에게 표시합니다
              </p>
            </div>
            <Switch
              checked={!!activityVisibility.show_last_seen}
              label="마지막 접속 시간 표시"
              disabled={updating === 'activity_visibility'}
              onCheckedChange={() =>
                updateSettingValue('activity_visibility', {
                  ...activityVisibility,
                  show_last_seen: !activityVisibility.show_last_seen,
                })
              }
            />
          </div>
        </div>
      </div>

      {/* 연락처 공개 설정 */}
      <div className="bg-gray-50 rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">연락처 공개 설정</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-700">이메일 주소 공개</label>
              <p className="text-sm text-gray-500">프로필에서 이메일 주소를 표시합니다</p>
            </div>
            <Switch
              checked={!!contactVisibility.show_email}
              label="이메일 주소 공개"
              disabled={updating === 'contact_visibility'}
              onCheckedChange={() =>
                updateSettingValue('contact_visibility', {
                  ...contactVisibility,
                  show_email: !contactVisibility.show_email,
                })
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-700">전화번호 공개</label>
              <p className="text-sm text-gray-500">프로필에서 전화번호를 표시합니다</p>
            </div>
            <Switch
              checked={!!contactVisibility.show_phone}
              label="전화번호 공개"
              disabled={updating === 'contact_visibility'}
              onCheckedChange={() =>
                updateSettingValue('contact_visibility', {
                  ...contactVisibility,
                  show_phone: !contactVisibility.show_phone,
                })
              }
            />
          </div>
        </div>
      </div>

      {/* 개인정보 관리 */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="text-sm text-blue-800">
          <p className="font-medium mb-2">🔒 개인정보 보호</p>
          <ul className="list-disc list-inside space-y-1">
            <li>개인정보는 관련 법령에 따라 안전하게 보호됩니다</li>
            <li>공개 범위 설정은 언제든지 변경할 수 있습니다</li>
            <li>관리자는 시스템 운영을 위해 필요시 정보에 접근할 수 있습니다</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

function getVisibilityLabel(level: string): string {
  switch (level) {
    case 'public':
      return '전체 공개'
    case 'members':
      return '멤버에게만 공개'
    case 'private':
      return '비공개'
    default:
      return level
  }
}

function getVisibilityDescription(level: string): string {
  switch (level) {
    case 'public':
      return '웹사이트 방문자 누구나 볼 수 있습니다'
    case 'members':
      return '승인된 멤버만 볼 수 있습니다'
    case 'private':
      return '나만 볼 수 있습니다'
    default:
      return ''
  }
}
