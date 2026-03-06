'use client'

import { useState } from 'react'
import type { SettingWithDefault, SettingCategory } from '@/types/index'

interface PreferenceSettingsProps {
  settings: SettingWithDefault[]
  onUpdate: (category: SettingCategory, key: string, value: any) => Promise<void>
}

export default function PreferenceSettings({ settings, onUpdate }: PreferenceSettingsProps) {
  const [updating, setUpdating] = useState<string | null>(null)

  const getSetting = (key: string) => {
    return settings.find(s => s.setting_key === key)?.setting_value || {}
  }

  const updateSettingValue = async (key: string, value: any) => {
    setUpdating(key)
    try {
      await onUpdate('preference', key, value)
    } finally {
      setUpdating(null)
    }
  }

  const contentFilter = getSetting('content_filter')
  const accessibility = getSetting('accessibility')
  const autoSave = getSetting('auto_save')

  return (
    <div className="space-y-8">
      {/* 콘텐츠 필터링 */}
      <div className="bg-gray-50 rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">콘텐츠 필터링</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-700">성인 콘텐츠 차단</label>
              <p className="text-sm text-gray-500">성인 콘텐츠로 분류된 게시글을 숨깁니다</p>
            </div>
            <button
              type="button"
              disabled={updating === 'content_filter'}
              onClick={() =>
                updateSettingValue('content_filter', {
                  ...contentFilter,
                  adult_content: !contentFilter.adult_content,
                })
              }
              className={`${
                contentFilter.adult_content ? 'bg-primary-600' : 'bg-gray-200'
              } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50`}
            >
              <span
                className={`${
                  contentFilter.adult_content ? 'translate-x-5' : 'translate-x-0'
                } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-700">폭력적 콘텐츠 차단</label>
              <p className="text-sm text-gray-500">폭력적이거나 충격적인 콘텐츠를 숨깁니다</p>
            </div>
            <button
              type="button"
              disabled={updating === 'content_filter'}
              onClick={() =>
                updateSettingValue('content_filter', {
                  ...contentFilter,
                  violence_content: !contentFilter.violence_content,
                })
              }
              className={`${
                contentFilter.violence_content ? 'bg-primary-600' : 'bg-gray-200'
              } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50`}
            >
              <span
                className={`${
                  contentFilter.violence_content ? 'translate-x-5' : 'translate-x-0'
                } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* 접근성 설정 */}
      <div className="bg-gray-50 rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">접근성 설정</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-700">고대비 모드</label>
              <p className="text-sm text-gray-500">
                텍스트와 배경의 대비를 높여 가독성을 향상시킵니다
              </p>
            </div>
            <button
              type="button"
              disabled={updating === 'accessibility'}
              onClick={() =>
                updateSettingValue('accessibility', {
                  ...accessibility,
                  high_contrast: !accessibility.high_contrast,
                })
              }
              className={`${
                accessibility.high_contrast ? 'bg-primary-600' : 'bg-gray-200'
              } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50`}
            >
              <span
                className={`${
                  accessibility.high_contrast ? 'translate-x-5' : 'translate-x-0'
                } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-700">큰 텍스트</label>
              <p className="text-sm text-gray-500">텍스트 크기를 크게 하여 가독성을 향상시킵니다</p>
            </div>
            <button
              type="button"
              disabled={updating === 'accessibility'}
              onClick={() =>
                updateSettingValue('accessibility', {
                  ...accessibility,
                  large_text: !accessibility.large_text,
                })
              }
              className={`${
                accessibility.large_text ? 'bg-primary-600' : 'bg-gray-200'
              } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50`}
            >
              <span
                className={`${
                  accessibility.large_text ? 'translate-x-5' : 'translate-x-0'
                } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-700">애니메이션 줄이기</label>
              <p className="text-sm text-gray-500">화면 전환 애니메이션을 최소화합니다</p>
            </div>
            <button
              type="button"
              disabled={updating === 'accessibility'}
              onClick={() =>
                updateSettingValue('accessibility', {
                  ...accessibility,
                  reduced_motion: !accessibility.reduced_motion,
                })
              }
              className={`${
                accessibility.reduced_motion ? 'bg-primary-600' : 'bg-gray-200'
              } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50`}
            >
              <span
                className={`${
                  accessibility.reduced_motion ? 'translate-x-5' : 'translate-x-0'
                } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
              />
            </button>
          </div>
        </div>

        {(accessibility.high_contrast ||
          accessibility.large_text ||
          accessibility.reduced_motion) && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
            <p className="text-sm text-blue-800">
              ℹ️ 접근성 설정 기능은 향후 업데이트에서 완전히 지원될 예정입니다.
            </p>
          </div>
        )}
      </div>

      {/* 자동 저장 설정 */}
      <div className="bg-gray-50 rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">자동 저장 설정</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-700">자동 저장 사용</label>
              <p className="text-sm text-gray-500">작성 중인 글을 자동으로 임시 저장합니다</p>
            </div>
            <button
              type="button"
              disabled={updating === 'auto_save'}
              onClick={() =>
                updateSettingValue('auto_save', {
                  ...autoSave,
                  enabled: !autoSave.enabled,
                })
              }
              className={`${
                autoSave.enabled ? 'bg-primary-600' : 'bg-gray-200'
              } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50`}
            >
              <span
                className={`${
                  autoSave.enabled ? 'translate-x-5' : 'translate-x-0'
                } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
              />
            </button>
          </div>

          {autoSave.enabled && (
            <div className="ml-4 border-l-2 border-gray-300 pl-4">
              <label
                htmlFor="auto-save-interval"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                저장 간격
              </label>
              <select
                id="auto-save-interval"
                disabled={updating === 'auto_save'}
                value={autoSave.interval_minutes || 5}
                onChange={e =>
                  updateSettingValue('auto_save', {
                    ...autoSave,
                    interval_minutes: parseInt(e.target.value),
                  })
                }
                className="block w-32 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-primary-500 focus:border-primary-500 disabled:opacity-50"
              >
                <option value={1}>1분</option>
                <option value={3}>3분</option>
                <option value={5}>5분</option>
                <option value={10}>10분</option>
                <option value={15}>15분</option>
              </select>
              <p className="mt-1 text-sm text-gray-500">
                설정된 시간마다 작성 중인 내용을 자동 저장합니다
              </p>
            </div>
          )}
        </div>
      </div>

      {/* 데이터 관리 */}
      <div className="bg-gray-50 rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">데이터 관리</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between py-3 border-b border-gray-200">
            <div>
              <h4 className="text-sm font-medium text-gray-700">설정 초기화</h4>
              <p className="text-sm text-gray-500">모든 설정을 기본값으로 되돌립니다</p>
            </div>
            <button
              type="button"
              className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
              onClick={() => {
                if (confirm('모든 설정을 기본값으로 초기화하시겠습니까?')) {
                  // 설정 초기화 API 호출
                  fetch('/api/settings/reset', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({}),
                  })
                    .then(() => {
                      alert('설정이 초기화되었습니다. 페이지를 새로고침하세요.')
                      window.location.reload()
                    })
                    .catch(() => {
                      alert('설정 초기화에 실패했습니다.')
                    })
                }
              }}
            >
              초기화
            </button>
          </div>

          <div className="flex items-center justify-between py-3 border-b border-gray-200">
            <div>
              <h4 className="text-sm font-medium text-gray-700">개인 데이터 내보내기</h4>
              <p className="text-sm text-gray-500">내 계정과 관련된 모든 데이터를 다운로드합니다</p>
            </div>
            <button
              type="button"
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
              onClick={() => {
                alert('데이터 내보내기 기능은 곧 추가될 예정입니다.')
              }}
            >
              내보내기
            </button>
          </div>

          <div className="flex items-center justify-between py-3">
            <div>
              <h4 className="text-sm font-medium text-gray-700">브라우저 캐시 초기화</h4>
              <p className="text-sm text-gray-500">브라우저에 저장된 임시 데이터를 삭제합니다</p>
            </div>
            <button
              type="button"
              className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
              onClick={() => {
                if (
                  confirm('브라우저 캐시를 초기화하시겠습니까? 일부 설정이 초기화될 수 있습니다.')
                ) {
                  // 로컬 스토리지 및 세션 스토리지 정리
                  localStorage.clear()
                  sessionStorage.clear()
                  alert('캐시가 초기화되었습니다.')
                }
              }}
            >
              초기화
            </button>
          </div>
        </div>
      </div>

      {/* 설정 안내 */}
      <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
        <div className="text-sm text-purple-800">
          <p className="font-medium mb-2">⚙️ 개인 취향 설정 안내</p>
          <ul className="list-disc list-inside space-y-1">
            <li>콘텐츠 필터링은 알고리즘 기반으로 완벽하지 않을 수 있습니다</li>
            <li>접근성 설정은 모든 브라우저에서 동일하게 작동하지 않을 수 있습니다</li>
            <li>자동 저장된 내용은 30일 후 자동으로 삭제됩니다</li>
            <li>설정 변경 사항은 즉시 적용됩니다</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
