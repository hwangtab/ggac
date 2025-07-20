'use client'

import { useState } from 'react'
import type { SettingWithDefault, SettingCategory } from '@/types/index'

interface InterfaceSettingsProps {
  settings: SettingWithDefault[]
  onUpdate: (category: SettingCategory, key: string, value: any) => Promise<void>
}

export default function InterfaceSettings({ settings, onUpdate }: InterfaceSettingsProps) {
  const [updating, setUpdating] = useState<string | null>(null)

  const getSetting = (key: string) => {
    return settings.find(s => s.setting_key === key)?.setting_value || {}
  }

  const updateSettingValue = async (key: string, value: any) => {
    setUpdating(key)
    try {
      await onUpdate('interface', key, value)
    } finally {
      setUpdating(null)
    }
  }

  const theme = getSetting('theme')
  const language = getSetting('language')
  const timezone = getSetting('timezone')
  const postDisplay = getSetting('post_display')

  return (
    <div className="space-y-8">
      {/* 테마 설정 */}
      <div className="bg-gray-50 rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">테마 설정</h3>
        <div className="space-y-3">
          {theme.options?.map((option: string) => (
            <div key={option} className="flex items-center">
              <input
                id={`theme-${option}`}
                name="theme"
                type="radio"
                disabled={updating === 'theme'}
                checked={theme.mode === option}
                onChange={() => updateSettingValue('theme', {
                  ...theme,
                  mode: option
                })}
                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 disabled:opacity-50"
              />
              <label htmlFor={`theme-${option}`} className="ml-3 text-sm">
                <span className="font-medium text-gray-700">{getThemeLabel(option)}</span>
                <p className="text-gray-500">{getThemeDescription(option)}</p>
              </label>
            </div>
          ))}
        </div>
        {theme.mode === 'dark' && (
          <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
            <p className="text-sm text-yellow-800">
              ⚠️ 다크 모드는 곧 지원될 예정입니다. 현재는 라이트 모드만 사용 가능합니다.
            </p>
          </div>
        )}
      </div>

      {/* 언어 설정 */}
      <div className="bg-gray-50 rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">언어 설정</h3>
        <div className="space-y-3">
          {language.options?.map((option: string) => (
            <div key={option} className="flex items-center">
              <input
                id={`language-${option}`}
                name="language"
                type="radio"
                disabled={updating === 'language'}
                checked={language.locale === option}
                onChange={() => updateSettingValue('language', {
                  ...language,
                  locale: option
                })}
                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 disabled:opacity-50"
              />
              <label htmlFor={`language-${option}`} className="ml-3 text-sm font-medium text-gray-700">
                {getLanguageLabel(option)}
              </label>
            </div>
          ))}
        </div>
        {language.locale === 'en' && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
            <p className="text-sm text-blue-800">
              ℹ️ 영어 버전은 향후 지원될 예정입니다.
            </p>
          </div>
        )}
      </div>

      {/* 시간대 설정 */}
      <div className="bg-gray-50 rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">시간대 설정</h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="timezone-select" className="block text-sm font-medium text-gray-700 mb-2">
              시간대
            </label>
            <select
              id="timezone-select"
              disabled={updating === 'timezone'}
              value={timezone.value || 'Asia/Seoul'}
              onChange={(e) => updateSettingValue('timezone', {
                ...timezone,
                value: e.target.value
              })}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 disabled:opacity-50"
            >
              <option value="Asia/Seoul">서울 (GMT+9)</option>
              <option value="UTC">UTC (GMT+0)</option>
              <option value="America/New_York">뉴욕 (GMT-5)</option>
              <option value="Europe/London">런던 (GMT+0)</option>
              <option value="Asia/Tokyo">도쿄 (GMT+9)</option>
            </select>
            <p className="mt-1 text-sm text-gray-500">
              게시글과 댓글의 시간이 선택한 시간대로 표시됩니다
            </p>
          </div>
        </div>
      </div>

      {/* 게시글 표시 설정 */}
      <div className="bg-gray-50 rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">게시글 표시 설정</h3>
        <div className="space-y-6">
          {/* 페이지당 항목 수 */}
          <div>
            <label htmlFor="items-per-page" className="block text-sm font-medium text-gray-700 mb-2">
              페이지당 게시글 수
            </label>
            <select
              id="items-per-page"
              disabled={updating === 'post_display'}
              value={postDisplay.items_per_page || 20}
              onChange={(e) => updateSettingValue('post_display', {
                ...postDisplay,
                items_per_page: parseInt(e.target.value)
              })}
              className="block w-32 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 disabled:opacity-50"
            >
              <option value={10}>10개</option>
              <option value={20}>20개</option>
              <option value={50}>50개</option>
              <option value={100}>100개</option>
            </select>
          </div>

          {/* 보기 모드 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">보기 모드</label>
            <div className="space-y-2">
              <div className="flex items-center">
                <input
                  id="view-card"
                  name="view-mode"
                  type="radio"
                  disabled={updating === 'post_display'}
                  checked={postDisplay.view_mode === 'card'}
                  onChange={() => updateSettingValue('post_display', {
                    ...postDisplay,
                    view_mode: 'card'
                  })}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 disabled:opacity-50"
                />
                <label htmlFor="view-card" className="ml-3 text-sm text-gray-700">
                  카드형 (기본)
                </label>
              </div>
              <div className="flex items-center">
                <input
                  id="view-list"
                  name="view-mode"
                  type="radio"
                  disabled={updating === 'post_display'}
                  checked={postDisplay.view_mode === 'list'}
                  onChange={() => updateSettingValue('post_display', {
                    ...postDisplay,
                    view_mode: 'list'
                  })}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 disabled:opacity-50"
                />
                <label htmlFor="view-list" className="ml-3 text-sm text-gray-700">
                  목록형
                </label>
              </div>
            </div>
          </div>

          {/* 이미지 표시 */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-700">이미지 자동 표시</label>
              <p className="text-sm text-gray-500">게시글의 이미지를 자동으로 표시합니다</p>
            </div>
            <button
              type="button"
              disabled={updating === 'post_display'}
              onClick={() => updateSettingValue('post_display', {
                ...postDisplay,
                show_images: !postDisplay.show_images
              })}
              className={`${
                postDisplay.show_images ? 'bg-primary-600' : 'bg-gray-200'
              } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50`}
            >
              <span
                className={`${
                  postDisplay.show_images ? 'translate-x-5' : 'translate-x-0'
                } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* 설정 안내 */}
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <div className="text-sm text-green-800">
          <p className="font-medium mb-2">🎨 인터페이스 설정 안내</p>
          <ul className="list-disc list-inside space-y-1">
            <li>설정은 즉시 적용되며 브라우저에 저장됩니다</li>
            <li>다른 기기에서는 별도로 설정해야 합니다</li>
            <li>브라우저 쿠키를 삭제하면 설정이 초기화될 수 있습니다</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

function getThemeLabel(mode: string): string {
  switch (mode) {
    case 'light':
      return '라이트 모드'
    case 'dark':
      return '다크 모드'
    case 'auto':
      return '시스템 설정에 따라'
    default:
      return mode
  }
}

function getThemeDescription(mode: string): string {
  switch (mode) {
    case 'light':
      return '밝은 배경의 화면으로 표시합니다'
    case 'dark':
      return '어두운 배경의 화면으로 표시합니다'
    case 'auto':
      return '운영체제 설정에 따라 자동으로 변경됩니다'
    default:
      return ''
  }
}

function getLanguageLabel(locale: string): string {
  switch (locale) {
    case 'ko':
      return '한국어'
    case 'en':
      return 'English'
    default:
      return locale
  }
}