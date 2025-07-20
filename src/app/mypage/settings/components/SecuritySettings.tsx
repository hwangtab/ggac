'use client'

import { useState } from 'react'
import type { SettingWithDefault, SettingCategory } from '@/types/index'

interface SecuritySettingsProps {
  settings: SettingWithDefault[]
  onUpdate: (category: SettingCategory, key: string, value: any) => Promise<void>
}

export default function SecuritySettings({ settings, onUpdate }: SecuritySettingsProps) {
  const [updating, setUpdating] = useState<string | null>(null)

  const getSetting = (key: string) => {
    return settings.find(s => s.setting_key === key)?.setting_value || {}
  }

  const updateSettingValue = async (key: string, value: any) => {
    setUpdating(key)
    try {
      await onUpdate('security', key, value)
    } finally {
      setUpdating(null)
    }
  }

  const sessionTimeout = getSetting('session_timeout')
  const loginNotifications = getSetting('login_notifications')
  const twoFactor = getSetting('two_factor')

  return (
    <div className="space-y-8">
      {/* 세션 타임아웃 설정 */}
      <div className="bg-gray-50 rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">세션 관리</h3>
        <div>
          <label htmlFor="session-timeout" className="block text-sm font-medium text-gray-700 mb-2">
            자동 로그아웃 시간
          </label>
          <select
            id="session-timeout"
            disabled={updating === 'session_timeout'}
            value={sessionTimeout.minutes || 480}
            onChange={(e) => updateSettingValue('session_timeout', {
              ...sessionTimeout,
              minutes: parseInt(e.target.value)
            })}
            className="block w-48 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 disabled:opacity-50"
          >
            {sessionTimeout.options?.map((option: number) => (
              <option key={option} value={option}>
                {getTimeoutLabel(option)}
              </option>
            ))}
          </select>
          <p className="mt-2 text-sm text-gray-500">
            비활성 상태가 지속되면 자동으로 로그아웃됩니다
          </p>
        </div>
      </div>

      {/* 로그인 알림 설정 */}
      <div className="bg-gray-50 rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">로그인 보안</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-700">새 기기 로그인 알림</label>
              <p className="text-sm text-gray-500">새로운 기기에서 로그인할 때 알림을 받습니다</p>
            </div>
            <button
              type="button"
              disabled={updating === 'login_notifications'}
              onClick={() => updateSettingValue('login_notifications', {
                ...loginNotifications,
                notify_new_device: !loginNotifications.notify_new_device
              })}
              className={`${
                loginNotifications.notify_new_device ? 'bg-primary-600' : 'bg-gray-200'
              } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50`}
            >
              <span
                className={`${
                  loginNotifications.notify_new_device ? 'translate-x-5' : 'translate-x-0'
                } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-700">의심스러운 활동 알림</label>
              <p className="text-sm text-gray-500">비정상적인 로그인 시도가 감지되면 알림을 받습니다</p>
            </div>
            <button
              type="button"
              disabled={updating === 'login_notifications'}
              onClick={() => updateSettingValue('login_notifications', {
                ...loginNotifications,
                notify_suspicious: !loginNotifications.notify_suspicious
              })}
              className={`${
                loginNotifications.notify_suspicious ? 'bg-primary-600' : 'bg-gray-200'
              } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50`}
            >
              <span
                className={`${
                  loginNotifications.notify_suspicious ? 'translate-x-5' : 'translate-x-0'
                } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* 2단계 인증 설정 */}
      <div className="bg-gray-50 rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">2단계 인증</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-700">2단계 인증 사용</label>
              <p className="text-sm text-gray-500">계정 보안을 강화하기 위해 2단계 인증을 사용합니다</p>
            </div>
            <button
              type="button"
              disabled={updating === 'two_factor'}
              onClick={() => updateSettingValue('two_factor', {
                ...twoFactor,
                enabled: !twoFactor.enabled
              })}
              className={`${
                twoFactor.enabled ? 'bg-primary-600' : 'bg-gray-200'
              } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50`}
            >
              <span
                className={`${
                  twoFactor.enabled ? 'translate-x-5' : 'translate-x-0'
                } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
              />
            </button>
          </div>

          {twoFactor.enabled && (
            <div className="ml-4 border-l-2 border-gray-300 pl-4">
              <label className="block text-sm font-medium text-gray-700 mb-3">인증 방법</label>
              <div className="space-y-2">
                {twoFactor.options?.map((option: string) => (
                  <div key={option} className="flex items-center">
                    <input
                      id={`2fa-${option}`}
                      name="two-factor-method"
                      type="radio"
                      disabled={updating === 'two_factor'}
                      checked={twoFactor.method === option}
                      onChange={() => updateSettingValue('two_factor', {
                        ...twoFactor,
                        method: option
                      })}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 disabled:opacity-50"
                    />
                    <label htmlFor={`2fa-${option}`} className="ml-3 text-sm text-gray-700">
                      {getTwoFactorLabel(option)}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {twoFactor.enabled && twoFactor.method !== 'none' && (
          <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
            <p className="text-sm text-yellow-800">
              ⚠️ 2단계 인증 기능은 향후 업데이트에서 지원될 예정입니다.
            </p>
          </div>
        )}
      </div>

      {/* 계정 관리 */}
      <div className="bg-gray-50 rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">계정 관리</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between py-3 border-b border-gray-200">
            <div>
              <h4 className="text-sm font-medium text-gray-700">비밀번호 변경</h4>
              <p className="text-sm text-gray-500">정기적인 비밀번호 변경으로 보안을 강화하세요</p>
            </div>
            <button
              type="button"
              className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
              onClick={() => {
                // 비밀번호 변경 페이지로 이동하거나 모달 표시
                alert('비밀번호 변경 기능은 곧 추가될 예정입니다.')
              }}
            >
              변경하기
            </button>
          </div>

          <div className="flex items-center justify-between py-3 border-b border-gray-200">
            <div>
              <h4 className="text-sm font-medium text-gray-700">이메일 주소 변경</h4>
              <p className="text-sm text-gray-500">로그인에 사용되는 이메일 주소를 변경합니다</p>
            </div>
            <button
              type="button"
              className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
              onClick={() => {
                alert('이메일 변경 기능은 곧 추가될 예정입니다.')
              }}
            >
              변경하기
            </button>
          </div>

          <div className="flex items-center justify-between py-3">
            <div>
              <h4 className="text-sm font-medium text-red-700">계정 삭제</h4>
              <p className="text-sm text-red-500">계정과 관련된 모든 데이터가 영구적으로 삭제됩니다</p>
            </div>
            <button
              type="button"
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
              onClick={() => {
                if (confirm('정말로 계정을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
                  alert('계정 삭제 기능은 관리자에게 문의해 주세요.')
                }
              }}
            >
              삭제 요청
            </button>
          </div>
        </div>
      </div>

      {/* 보안 안내 */}
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <div className="text-sm text-red-800">
          <p className="font-medium mb-2">🔐 보안 주의사항</p>
          <ul className="list-disc list-inside space-y-1">
            <li>비밀번호는 주기적으로 변경하고 다른 사이트와 다르게 설정하세요</li>
            <li>공용 컴퓨터에서는 로그아웃을 꼭 하세요</li>
            <li>의심스러운 활동이 감지되면 즉시 비밀번호를 변경하세요</li>
            <li>개인정보가 포함된 내용은 게시하지 마세요</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

function getTimeoutLabel(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}분`
  } else if (minutes < 1440) {
    return `${minutes / 60}시간`
  } else {
    return `${minutes / 1440}일`
  }
}

function getTwoFactorLabel(method: string): string {
  switch (method) {
    case 'none':
      return '사용 안함'
    case 'email':
      return '이메일 인증'
    case 'sms':
      return 'SMS 인증'
    default:
      return method
  }
}