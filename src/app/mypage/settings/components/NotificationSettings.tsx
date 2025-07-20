'use client'

import { useState } from 'react'
import type { SettingWithDefault, SettingCategory } from '@/types/index'

interface NotificationSettingsProps {
  settings: SettingWithDefault[]
  onUpdate: (category: SettingCategory, key: string, value: any) => Promise<void>
}

export default function NotificationSettings({ settings, onUpdate }: NotificationSettingsProps) {
  const [updating, setUpdating] = useState<string | null>(null)

  const getSetting = (key: string) => {
    return settings.find(s => s.setting_key === key)?.setting_value || {}
  }

  const updateSettingValue = async (key: string, value: any) => {
    setUpdating(key)
    try {
      await onUpdate('notification', key, value)
    } finally {
      setUpdating(null)
    }
  }

  const emailNotifications = getSetting('email_notifications')
  const webNotifications = getSetting('web_notifications')
  const notificationFrequency = getSetting('notification_frequency')

  return (
    <div className="space-y-8">
      {/* 이메일 알림 설정 */}
      <div className="bg-gray-50 rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">이메일 알림</h3>
        <div className="space-y-4">
          {/* 이메일 알림 활성화 */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-700">이메일 알림 받기</label>
              <p className="text-sm text-gray-500">중요한 알림을 이메일로 받습니다</p>
            </div>
            <button
              type="button"
              disabled={updating === 'email_notifications'}
              onClick={() => updateSettingValue('email_notifications', {
                ...emailNotifications,
                enabled: !emailNotifications.enabled
              })}
              className={`${
                emailNotifications.enabled ? 'bg-primary-600' : 'bg-gray-200'
              } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50`}
            >
              <span
                className={`${
                  emailNotifications.enabled ? 'translate-x-5' : 'translate-x-0'
                } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
              />
            </button>
          </div>

          {/* 세부 이메일 알림 설정 */}
          {emailNotifications.enabled && (
            <div className="ml-4 space-y-3 border-l-2 border-gray-300 pl-4">
              <div className="flex items-center">
                <input
                  id="email-post-notifications"
                  type="checkbox"
                  disabled={updating === 'email_notifications'}
                  checked={emailNotifications.post_notifications || false}
                  onChange={(e) => updateSettingValue('email_notifications', {
                    ...emailNotifications,
                    post_notifications: e.target.checked
                  })}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded disabled:opacity-50"
                />
                <label htmlFor="email-post-notifications" className="ml-3 text-sm text-gray-700">
                  새 게시글 알림
                </label>
              </div>
              <div className="flex items-center">
                <input
                  id="email-comment-notifications"
                  type="checkbox"
                  disabled={updating === 'email_notifications'}
                  checked={emailNotifications.comment_notifications || false}
                  onChange={(e) => updateSettingValue('email_notifications', {
                    ...emailNotifications,
                    comment_notifications: e.target.checked
                  })}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded disabled:opacity-50"
                />
                <label htmlFor="email-comment-notifications" className="ml-3 text-sm text-gray-700">
                  댓글 알림
                </label>
              </div>
              <div className="flex items-center">
                <input
                  id="email-system-notifications"
                  type="checkbox"
                  disabled={updating === 'email_notifications'}
                  checked={emailNotifications.system_notifications || false}
                  onChange={(e) => updateSettingValue('email_notifications', {
                    ...emailNotifications,
                    system_notifications: e.target.checked
                  })}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded disabled:opacity-50"
                />
                <label htmlFor="email-system-notifications" className="ml-3 text-sm text-gray-700">
                  시스템 공지 알림
                </label>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 웹 푸시 알림 설정 */}
      <div className="bg-gray-50 rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">웹 푸시 알림</h3>
        <div className="space-y-4">
          {/* 웹 알림 활성화 */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-700">브라우저 알림 받기</label>
              <p className="text-sm text-gray-500">브라우저에서 실시간 알림을 받습니다</p>
            </div>
            <button
              type="button"
              disabled={updating === 'web_notifications'}
              onClick={() => updateSettingValue('web_notifications', {
                ...webNotifications,
                enabled: !webNotifications.enabled
              })}
              className={`${
                webNotifications.enabled ? 'bg-primary-600' : 'bg-gray-200'
              } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50`}
            >
              <span
                className={`${
                  webNotifications.enabled ? 'translate-x-5' : 'translate-x-0'
                } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
              />
            </button>
          </div>

          {/* 세부 웹 알림 설정 */}
          {webNotifications.enabled && (
            <div className="ml-4 space-y-3 border-l-2 border-gray-300 pl-4">
              <div className="flex items-center">
                <input
                  id="web-post-notifications"
                  type="checkbox"
                  disabled={updating === 'web_notifications'}
                  checked={webNotifications.post_notifications || false}
                  onChange={(e) => updateSettingValue('web_notifications', {
                    ...webNotifications,
                    post_notifications: e.target.checked
                  })}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded disabled:opacity-50"
                />
                <label htmlFor="web-post-notifications" className="ml-3 text-sm text-gray-700">
                  새 게시글 알림
                </label>
              </div>
              <div className="flex items-center">
                <input
                  id="web-comment-notifications"
                  type="checkbox"
                  disabled={updating === 'web_notifications'}
                  checked={webNotifications.comment_notifications || false}
                  onChange={(e) => updateSettingValue('web_notifications', {
                    ...webNotifications,
                    comment_notifications: e.target.checked
                  })}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded disabled:opacity-50"
                />
                <label htmlFor="web-comment-notifications" className="ml-3 text-sm text-gray-700">
                  댓글 알림
                </label>
              </div>
              <div className="flex items-center">
                <input
                  id="web-mention-notifications"
                  type="checkbox"
                  disabled={updating === 'web_notifications'}
                  checked={webNotifications.mention_notifications || false}
                  onChange={(e) => updateSettingValue('web_notifications', {
                    ...webNotifications,
                    mention_notifications: e.target.checked
                  })}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded disabled:opacity-50"
                />
                <label htmlFor="web-mention-notifications" className="ml-3 text-sm text-gray-700">
                  멘션 알림
                </label>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 알림 빈도 설정 */}
      <div className="bg-gray-50 rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">알림 빈도</h3>
        <div className="space-y-3">
          {notificationFrequency.options?.map((option: string) => (
            <div key={option} className="flex items-center">
              <input
                id={`frequency-${option}`}
                name="notification-frequency"
                type="radio"
                disabled={updating === 'notification_frequency'}
                checked={notificationFrequency.value === option}
                onChange={() => updateSettingValue('notification_frequency', {
                  ...notificationFrequency,
                  value: option
                })}
                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 disabled:opacity-50"
              />
              <label htmlFor={`frequency-${option}`} className="ml-3 text-sm text-gray-700">
                {getFrequencyLabel(option)}
              </label>
            </div>
          ))}
        </div>
      </div>

      {/* 안내 메시지 */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="text-sm text-blue-800">
          <p className="font-medium mb-1">💡 알림 설정 안내</p>
          <ul className="list-disc list-inside space-y-1">
            <li>이메일 알림은 등록된 이메일 주소로 전송됩니다</li>
            <li>웹 푸시 알림을 받으려면 브라우저에서 알림 권한을 허용해야 합니다</li>
            <li>중요한 시스템 공지는 설정과 관계없이 전송될 수 있습니다</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

function getFrequencyLabel(value: string): string {
  switch (value) {
    case 'immediate':
      return '즉시 (실시간)'
    case 'daily':
      return '일일 요약'
    case 'weekly':
      return '주간 요약'
    case 'never':
      return '받지 않음'
    default:
      return value
  }
}