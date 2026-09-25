'use client'

import { useState, useEffect, useRef } from 'react'
import {
  FiSave,
  FiSettings,
  FiMail,
  FiShield,
  FiGlobe,
  FiDatabase,
  FiRefreshCw,
  FiDownload,
  FiUpload,
  FiRotateCcw,
  FiAlertTriangle,
} from 'react-icons/fi'
import AdminLayout from '../components/AdminLayout'
import {
  validateField,
  validateAllSettings,
  type ValidationError,
} from '@/utils/settingsValidation'
import { parseIntegerParam } from '@/utils/queryParams'
import {
  FEE_RATE_RANGE_MESSAGE,
  FEE_RATE_VAT_NOTE,
  feeRatePercentToBp,
  formatFeeRatePercent,
} from '@/lib/funding/feeRate'

interface AdminSettings {
  site: {
    maintenance_mode: boolean
    registration_enabled: boolean
    site_title: string
    site_description: string
    max_members: number
  }
  email: {
    smtp_host: string
    smtp_port: number
    smtp_user: string
    smtp_password: string
    from_email: string
    from_name: string
  }
  security: {
    session_timeout: number
    max_login_attempts: number
    password_min_length: number
    require_email_verification: boolean
  }
  features: {
    board_enabled: boolean
    artist_registration_enabled: boolean
    comments_enabled: boolean
    file_uploads_enabled: boolean
    funding_enabled: boolean
    /** 조합원 요율(만분율). 화면은 퍼센트로 보여 준다. */
    funding_fee_rate_member_bp: number
    /** 비조합원 요율(만분율). */
    funding_fee_rate_nonmember_bp: number
  }
}

/** 화면이 퍼센트 문자열을 들고 있는 두 칸. 키는 `features`의 필드 이름과 짝이다. */
type FeeRateField = 'funding_fee_rate_member_bp' | 'funding_fee_rate_nonmember_bp'

/**
 * 저장 시 **바뀐 값만** 골라낸다(최종 리뷰 B-3).
 *
 * 예전에는 `settings` 객체 전체를 PUT했다. 그런데 GET은 `is_sensitive` 설정
 * (`smtp_config`)을 마스킹해서 내려주고, 그것이 화면에서는 빈 값·기본값으로
 * 보인다 — 즉 화면은 SMTP의 진짜 값을 **애초에 가지고 있지 않다.** 그 상태로
 * 전체를 PUT하면 유지보수 모드 토글 한 번에 SMTP 설정이 빈 값으로 덮인다.
 *
 * 서버에도 같은 사고를 막는 방어가 있지만(마스킹된 값의 되쓰기 차단),
 * 화면이 애초에 안 건드린 것을 보내지 않는 쪽이 정확하다 — 서버 방어는
 * 오래된 탭·다른 클라이언트를 위한 최후의 그물이다.
 *
 * PUT 스키마는 모든 카테고리·필드가 optional이라 부분 페이로드를 그대로 받는다.
 */
function diffSettings(
  next: AdminSettings,
  baseline: AdminSettings | null
): Partial<Record<keyof AdminSettings, Record<string, unknown>>> {
  const payload: Partial<Record<keyof AdminSettings, Record<string, unknown>>> = {}
  if (!baseline) return next as unknown as typeof payload
  ;(Object.keys(next) as Array<keyof AdminSettings>).forEach(category => {
    const nextCategory = next[category] as Record<string, unknown>
    const baseCategory = (baseline[category] ?? {}) as Record<string, unknown>
    const changed: Record<string, unknown> = {}

    Object.keys(nextCategory).forEach(key => {
      if (nextCategory[key] !== baseCategory[key]) {
        changed[key] = nextCategory[key]
      }
    })

    if (Object.keys(changed).length > 0) {
      payload[category] = changed
    }
  })

  return payload
}

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<AdminSettings | null>(null)
  // 서버가 마지막으로 내려준(=저장된) 값. 저장 시 이것과의 차이만 보낸다.
  const savedSettingsRef = useRef<AdminSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState<'site' | 'email' | 'security' | 'features' | 'backup'>(
    'site'
  )
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [backupLoading, setBackupLoading] = useState(false)
  const [restoreLoading, setRestoreLoading] = useState(false)
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([])
  /**
   * 요율 칸이 **입력 중인 글자 그대로**를 들고 있는 자리. `settings`에는
   * 옮길 수 있는 bp만 들어가므로, 여기가 없으면 "3."을 치는 순간 칸이
   * 되감기거나 옮길 수 없는 입력이 조용히 사라진다.
   */
  const [feeRateInputs, setFeeRateInputs] = useState<Record<FeeRateField, string>>({
    funding_fee_rate_member_bp: '',
    funding_fee_rate_nonmember_bp: '',
  })
  const [feeRateErrors, setFeeRateErrors] = useState<Partial<Record<FeeRateField, string>>>({})
  /**
   * 이메일 인증 관문을 켰을 때 **막히는 사람 수**. 설정과 따로 불러온다 —
   * 저장할 수 없는 관측값이라 설정 객체에 섞으면 저장 페이로드로 되돌아간다.
   */
  const [verificationCoverage, setVerificationCoverage] = useState<{
    approved: number
    unverified: number
    unverified_admins: number
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearStatusTimer = () => {
    if (statusTimerRef.current) {
      clearTimeout(statusTimerRef.current)
      statusTimerRef.current = null
    }
  }

  const scheduleStatusClear = (delayMs: number, options: { clearError?: boolean } = {}) => {
    const { clearError = true } = options
    clearStatusTimer()
    statusTimerRef.current = setTimeout(() => {
      setSuccess(null)
      if (clearError) {
        setError(null)
      }
      statusTimerRef.current = null
    }, delayMs)
  }

  useEffect(() => {
    fetchSettings()
    fetchVerificationCoverage()
  }, [])

  useEffect(() => {
    return clearStatusTimer
  }, [])

  const fetchSettings = async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch('/api/admin/settings')
      if (!response.ok) {
        throw new Error('설정 정보를 불러오는 중 오류가 발생했습니다.')
      }

      const json = await response.json()
      setSettings(json.data)
      savedSettingsRef.current = json.data
      setFeeRateInputs({
        funding_fee_rate_member_bp: formatFeeRatePercent(
          json.data?.features?.funding_fee_rate_member_bp
        ),
        funding_fee_rate_nonmember_bp: formatFeeRatePercent(
          json.data?.features?.funding_fee_rate_nonmember_bp
        ),
      })
      setFeeRateErrors({})
    } catch (err) {
      console.error('Settings fetch error:', err)
      setError(err instanceof Error ? err.message : '설정 정보를 불러오는 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  /**
   * 관문을 켜기 전에 봐야 하는 숫자를 가져온다. 실패해도 설정 화면 자체는
   * 그대로 뜬다 — 숫자가 없으면 그 자리에 "확인하지 못했다"고 적는다.
   */
  const fetchVerificationCoverage = async () => {
    try {
      const response = await fetch('/api/admin/settings/email-verification')
      if (response.ok === false) throw new Error('현황 조회 실패')
      const json = await response.json()
      setVerificationCoverage(json.data ?? null)
    } catch (err) {
      console.error('Email verification coverage fetch error:', err)
      setVerificationCoverage(null)
    }
  }

  const saveSettings = async () => {
    if (!settings) return

    try {
      setSaving(true)
      clearStatusTimer()
      setError(null)
      setSuccess(null)

      // 요율 칸은 `settings`에 옮길 수 없는 입력을 담지 않는다. 그래서
      // 여기서 막지 않으면 **화면에 적힌 것과 다른(직전의 멀쩡한) 값**이
      // 저장되고, 사무국은 성공 메시지를 본다.
      const badFeeRate = (Object.keys(feeRateErrors) as FeeRateField[]).find(
        key => feeRateErrors[key]
      )
      if (badFeeRate) {
        throw new Error(feeRateErrors[badFeeRate] as string)
      }

      // 저장 전 전체 설정 유효성 검증
      const validationResult = validateAllSettings(settings)
      if (!validationResult.isValid) {
        setValidationErrors(validationResult.errors)
        throw new Error(
          `설정에 오류가 있습니다: ${validationResult.errors.map(e => e.message).join(', ')}`
        )
      }

      // 바뀐 값만 보낸다(diffSettings 주석 참고). 아무것도 안 바뀌었으면
      // 요청 자체를 보내지 않는다 — 빈 PUT은 무의미한 변경 이력만 남긴다.
      const changedSettings = diffSettings(settings, savedSettingsRef.current)
      if (Object.keys(changedSettings).length === 0) {
        setSuccess('변경된 설정이 없습니다.')
        scheduleStatusClear(3000, { clearError: false })
        return
      }

      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(changedSettings),
      })

      if (!response.ok) {
        throw new Error('설정 저장 중 오류가 발생했습니다.')
      }

      // 라우트는 항목마다 따로 저장하고, 일부가 실패해도 **200**으로 답하면서
      // 실패한 항목을 `data.errors`에 담는다(`api/admin/settings/route.ts`의
      // 마지막 `ApiSuccess.ok`). `response.ok`만 보고 성공이라 말하면 두 가지가
      // 어긋난다 — 저장되지 않은 값을 저장됐다고 알리고, `savedSettingsRef`에
      // 그대로 기록해 다음 저장 때 그 항목이 "바뀐 값"에서 빠진다. 한 번 실패한
      // 항목은 그때부터 영영 못 고친다.
      const body = await response.json().catch(() => null)
      const failedKeys: string[] = Array.isArray(body?.data?.errors) ? body.data.errors : []
      if (failedKeys.length > 0) {
        throw new Error(
          `일부 설정을 저장하지 못했습니다: ${failedKeys.join(', ')}. ` +
            '저장하려는 설정 항목이 데이터베이스에 없으면 이렇게 됩니다.'
        )
      }

      savedSettingsRef.current = settings
      setSuccess('설정이 성공적으로 저장되었습니다.')
      setValidationErrors([]) // 저장 성공 시 유효성 오류 초기화

      // 설정 저장 후 캐시 무효화
      try {
        await fetch('/api/admin/settings/cache', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ cacheType: 'all' }),
        })
      } catch (cacheError) {
        console.warn('Failed to invalidate settings cache:', cacheError)
        // 캐시 무효화 실패는 치명적이지 않으므로 사용자에게는 알리지 않음
      }

      scheduleStatusClear(3000, { clearError: false })
    } catch (err) {
      console.error('Settings save error:', err)
      setError(err instanceof Error ? err.message : '설정 저장 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const updateSettings = (section: keyof AdminSettings, key: string, value: any) => {
    if (!settings) return

    // 설정 업데이트
    const newSettings = {
      ...settings,
      [section]: {
        ...settings[section],
        [key]: value,
      },
    }
    setSettings(newSettings)

    // 실시간 유효성 검증
    const fieldError = validateField(section, key, value)

    // 기존 오류에서 해당 필드 오류 제거
    const filteredErrors = validationErrors.filter(
      err => err.field !== key || err.category !== section
    )

    // 새로운 오류가 있으면 추가
    if (fieldError) {
      setValidationErrors([...filteredErrors, fieldError])
    } else {
      setValidationErrors(filteredErrors)
    }
  }

  /**
   * 요율 칸 한 개의 입력을 받는다. 옮길 수 있으면 bp로 바꿔 설정에 담고,
   * 옮길 수 없으면 **담지 않고** 범위를 말한다 — 조용히 반올림하거나 0으로
   * 떨어뜨리지 않는다.
   */
  const updateFeeRate = (field: FeeRateField, text: string) => {
    setFeeRateInputs(prev => ({ ...prev, [field]: text }))

    const bp = feeRatePercentToBp(text.trim())
    if (bp === null) {
      setFeeRateErrors(prev => ({ ...prev, [field]: FEE_RATE_RANGE_MESSAGE }))
      return
    }

    setFeeRateErrors(prev => {
      const next = { ...prev }
      delete next[field]
      return next
    })
    updateSettings('features', field, bp)
  }

  // 백업 다운로드 함수
  const downloadBackup = async () => {
    try {
      setBackupLoading(true)
      clearStatusTimer()
      setError(null)
      setSuccess(null)

      const response = await fetch('/api/admin/settings/backup', {
        method: 'GET',
      })

      if (!response.ok) {
        throw new Error('백업 파일 생성에 실패했습니다.')
      }

      // 파일 다운로드
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ggac-settings-backup-${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)

      setSuccess('백업 파일이 다운로드되었습니다.')
      scheduleStatusClear(3000, { clearError: false })
    } catch (err) {
      console.error('Backup download error:', err)
      setError(err instanceof Error ? err.message : '백업 다운로드 중 오류가 발생했습니다.')
    } finally {
      setBackupLoading(false)
    }
  }

  // 백업 복원 함수
  const restoreBackup = async (file: File) => {
    try {
      setRestoreLoading(true)
      clearStatusTimer()
      setError(null)
      setSuccess(null)

      // 파일 읽기
      const fileContent = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = e => resolve(e.target?.result as string)
        reader.onerror = () => reject(new Error('파일 읽기에 실패했습니다.'))
        reader.readAsText(file)
      })

      let backupData
      try {
        backupData = JSON.parse(fileContent)
      } catch (err) {
        throw new Error('유효하지 않은 JSON 파일입니다.')
      }

      // 백업 파일 복원 요청
      const response = await fetch('/api/admin/settings/backup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(backupData),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || '백업 복원에 실패했습니다.')
      }

      const result = await response.json()

      if (result.data?.errors?.length === 0) {
        setSuccess(result.message)
        // 설정 새로고침
        await fetchSettings()
      } else {
        setError(result.message)
      }

      scheduleStatusClear(5000)
    } catch (err) {
      console.error('Backup restore error:', err)
      setError(err instanceof Error ? err.message : '백업 복원 중 오류가 발생했습니다.')
    } finally {
      setRestoreLoading(false)
    }
  }

  // 파일 선택 핸들러
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      if (!file.name.endsWith('.json')) {
        setError('JSON 파일만 업로드할 수 있습니다.')
        return
      }

      if (confirm('백업 파일을 복원하시겠습니까? 현재 설정이 덮어쓰여집니다.')) {
        restoreBackup(file)
      }
    }
    // 파일 입력 리셋
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // 기본값 복원 함수
  const resetToDefaults = async () => {
    if (!confirm('정말로 모든 설정을 기본값으로 되돌리시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
      return
    }

    try {
      setRestoreLoading(true)
      clearStatusTimer()
      setError(null)
      setSuccess(null)

      const response = await fetch('/api/admin/settings/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          resetType: 'all',
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || '기본값 복원에 실패했습니다.')
      }

      const result = await response.json()

      if (result.data?.errors?.length === 0) {
        setSuccess(result.message)
        // 설정 새로고침
        await fetchSettings()

        // 기본값 복원 후 캐시 무효화
        try {
          await fetch('/api/admin/settings/cache', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ cacheType: 'all' }),
          })
        } catch (cacheError) {
          console.warn('Failed to invalidate settings cache after reset:', cacheError)
        }
      } else {
        setError(result.message)
      }

      scheduleStatusClear(5000)
    } catch (err) {
      console.error('Reset to defaults error:', err)
      setError(err instanceof Error ? err.message : '기본값 복원 중 오류가 발생했습니다.')
    } finally {
      setRestoreLoading(false)
    }
  }

  // 필드별 유효성 검증 오류 가져오기
  const getFieldError = (category: string, field: string): string | null => {
    const error = validationErrors.find(err => err.category === category && err.field === field)
    return error ? error.message : null
  }

  // 필드 스타일 클래스 생성
  const getFieldClassName = (category: string, field: string, baseClassName: string): string => {
    const hasError = getFieldError(category, field)
    return hasError
      ? `${baseClassName} border-red-300 focus:ring-red-500 focus:border-red-500`
      : baseClassName
  }

  const tabs = [
    { id: 'site', label: '사이트 설정', icon: FiGlobe },
    { id: 'email', label: '이메일 설정', icon: FiMail },
    { id: 'security', label: '보안 설정', icon: FiShield },
    { id: 'features', label: '기능 설정', icon: FiSettings },
    { id: 'backup', label: '백업/복원', icon: FiDatabase },
  ] as const

  if (loading) {
    return (
      <AdminLayout title="시스템 설정" description="사이트 전체 설정 관리">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4"></div>
            <p className="text-gray-600">설정을 불러오는 중...</p>
          </div>
        </div>
      </AdminLayout>
    )
  }

  if (error && !settings) {
    return (
      <AdminLayout title="시스템 설정" description="사이트 전체 설정 관리">
        <div className="text-center py-8">
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={fetchSettings}
            className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700"
          >
            다시 시도
          </button>
        </div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout title="시스템 설정" description="사이트 전체 설정 관리">
      <div className="space-y-6">
        {/* 알림 메시지 */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-700">{error}</p>
          </div>
        )}

        {success && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <p className="text-green-700">{success}</p>
          </div>
        )}

        {/* 유효성 검증 오류 */}
        {validationErrors.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div className="flex items-start">
              <FiAlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 mr-2 flex-shrink-0" />
              <div>
                <h4 className="text-sm font-medium text-amber-800 mb-2">설정 오류</h4>
                <ul className="text-sm text-amber-700 space-y-1">
                  {validationErrors.map((error, index) => (
                    <li key={index} className="flex items-center">
                      <span className="w-2 h-2 bg-amber-400 rounded-full mr-2 flex-shrink-0"></span>
                      <span>
                        <strong>{error.category}</strong>: {error.message}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* 탭 네비게이션 */}
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="border-b border-gray-200">
            <nav className="flex space-x-8 px-6">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === tab.id
                      ? 'border-primary-500 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <tab.icon className="w-5 h-5 mr-2" />
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* 설정 콘텐츠 */}
          <div className="p-6">
            {settings && (
              <>
                {/* 사이트 설정 */}
                {activeTab === 'site' && (
                  <div className="space-y-6">
                    <div>
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={settings.site.maintenance_mode}
                          onChange={e =>
                            updateSettings('site', 'maintenance_mode', e.target.checked)
                          }
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 mr-2"
                        />
                        <span className="text-sm font-medium text-gray-700">유지보수 모드</span>
                      </label>
                      <p className="text-xs text-gray-500 ml-6">
                        활성화 시 관리자만 사이트 접근 가능
                      </p>
                    </div>

                    <div>
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={settings.site.registration_enabled}
                          onChange={e =>
                            updateSettings('site', 'registration_enabled', e.target.checked)
                          }
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 mr-2"
                        />
                        <span className="text-sm font-medium text-gray-700">회원 가입 허용</span>
                      </label>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        사이트 제목
                      </label>
                      <input
                        type="text"
                        value={settings.site.site_title}
                        onChange={e => updateSettings('site', 'site_title', e.target.value)}
                        className={getFieldClassName(
                          'site',
                          'site_title',
                          'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500'
                        )}
                      />
                      {getFieldError('site', 'site_title') && (
                        <p className="mt-1 text-sm text-red-600">
                          {getFieldError('site', 'site_title')}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        사이트 설명
                      </label>
                      <textarea
                        value={settings.site.site_description}
                        onChange={e => updateSettings('site', 'site_description', e.target.value)}
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        최대 회원 수
                      </label>
                      <input
                        type="number"
                        value={settings.site.max_members}
                        onChange={e =>
                          updateSettings(
                            'site',
                            'max_members',
                            parseIntegerParam(e.target.value, 0, { min: 0 })
                          )
                        }
                        className={getFieldClassName(
                          'site',
                          'max_members',
                          'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500'
                        )}
                      />
                      {getFieldError('site', 'max_members') && (
                        <p className="mt-1 text-sm text-red-600">
                          {getFieldError('site', 'max_members')}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/*
                  여기에 SMTP 호스트·포트·사용자명·비밀번호·발신자 이메일·
                  발신자 이름 여섯 칸이 있었다. **하나도 통제하지 않았다** —
                  메일은 Resend HTTP API로 나가고(`src/lib/mail/send.ts`,
                  `src/lib/auth/email.ts`) 이 저장소에는 SMTP 클라이언트 자체가
                  없다. 여섯 값을 읽는 코드는 저장·검증·매핑 기계뿐이고
                  (`getSmtpConfig`는 부르는 자리가 0이다), 발신 주소는 코드에
                  박혀 있다.

                  값은 `system_settings`의 `email/smtp_config` 행에 그대로
                  남겨 둔다. 화면에서 칸을 치우는 것과 저장된 행을 지우는 것은
                  다른 일이고, PUT 매핑·검증 스키마를 함께 뜯으면 **지금 동작하는
                  설정들의 저장 경로**가 같이 흔들린다.
                */}
                {activeTab === 'email' && (
                  <div className="space-y-4">
                    <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
                      <p className="font-medium text-gray-800">메일은 Resend로 나갑니다</p>
                      <p className="mt-1">
                        SMTP 서버를 쓰지 않습니다. 가입 인증·비밀번호 재설정·알림 메일 모두 Resend
                        HTTP API로 발송되며, 여기서 바꿀 수 있는 것은 없습니다.
                      </p>
                      <dl className="mt-3 space-y-2">
                        <div>
                          <dt className="text-xs text-gray-500">발신 주소</dt>
                          <dd className="font-medium text-gray-900">
                            경기아트콜렉티브 &lt;noreply@ggac.kr&gt;
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-gray-500">회신 주소</dt>
                          <dd className="font-medium text-gray-900">
                            환경변수 <code>MAILBOX_REPLY_TO</code>
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-gray-500">발송 키</dt>
                          <dd className="font-medium text-gray-900">
                            환경변수 <code>RESEND_API_KEY</code>
                          </dd>
                        </div>
                      </dl>
                      <p className="mt-3 text-xs text-gray-500">
                        발신 주소를 바꾸려면 코드를, 회신 주소와 발송 키를 바꾸려면 Vercel
                        환경변수를 고쳐야 합니다.
                      </p>
                    </div>
                  </div>
                )}

                {/* 보안 설정 */}
                {activeTab === 'security' && (
                  <div className="space-y-4">
                    {/*
                      여기에 세션 타임아웃·최대 로그인 시도 횟수·최소 비밀번호
                      길이 세 칸이 있었다. **셋 다 아무것도 통제하지 않았다** —
                      Better Auth 설정(`src/lib/auth/server.ts`)은 이 값들을
                      읽지 않고, 세션 수명과 쿠키 캐시와 최소 길이는 코드에
                      상수로 박혀 있다. 로그인 시도는 횟수로 잠그는 방식이
                      아니라 IP 기준 레이트리밋이고, 그 한도는
                      `src/utils/distributedRateLimiter.ts`의 `AUTH_API`다.

                      숫자를 적어 두는 이유: 통제하지 못하는 칸이라도 사무국은
                      "그래서 세션이 얼마나 유지되는가"를 알아야 한다. 칸만
                      치우면 그 질문에 답할 자리가 없어진다.

                      저장된 `system_settings` 행과 PUT 매핑·검증은 그대로 둔다
                      (이메일 탭과 같은 판단).
                    */}
                    <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
                      <p className="font-medium text-gray-800">세션</p>
                      <p className="mt-1">
                        로그인하면 세션이 <strong>7일</strong> 유지되고, 사용 중이면 하루마다 만료가
                        연장됩니다. 세션 쿠키 캐시는 5분이라 권한을 바꿔도 최대 5분은 이전 상태로
                        동작합니다. 비밀번호를 재설정하면 그 사람의 기존 세션은 전부 끊깁니다.
                      </p>
                    </div>

                    <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
                      <p className="font-medium text-gray-800">로그인 시도</p>
                      <p className="mt-1">
                        틀린 횟수로 계정을 잠그지 않습니다. 대신 접속 주소(IP) 기준으로 로그인
                        요청이 <strong>1분에 10회</strong>를 넘으면 <strong>15분</strong> 동안
                        막습니다. 비밀번호 재설정 메일은 10분에 5회까지이고, 넘기면 30분 막힙니다.
                      </p>
                    </div>

                    <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-600">
                      <p className="font-medium text-gray-800">비밀번호</p>
                      <p className="mt-1">
                        최소 <strong>8자</strong>입니다. 대문자·숫자·특수문자를 따로 요구하지
                        않습니다.
                      </p>
                    </div>

                    {/*
                      이 자리에 있던 "이메일 인증 필수" 체크박스는 아무것도
                      통제하지 못해 한 번 걷어냈다가, 관문
                      (`@/lib/auth/emailVerificationGate`)을 만들어 다시 놓았다.
                      이제 켜면 실제로 로그인이 막힌다.

                      스위치가 읽는 칸은 `email_verification.enforce_on_login`
                      이다. 운영 행에 남아 있는 옛 `required`는 아무도 읽지
                      않는다 — 그 칸을 읽었다면 배포하는 순간 관문이 켜진
                      상태로 떠서 미인증 회원이 문 앞에서 막혔을 것이다.
                      같은 설정의 `resend_limit`·`token_expiry_hours`는 여전히
                      읽는 코드가 없다(Better Auth가 자기 기본값을 쓴다).
                    */}
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-gray-700">
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={settings.security.require_email_verification}
                          onChange={e =>
                            updateSettings(
                              'security',
                              'require_email_verification',
                              e.target.checked
                            )
                          }
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 mr-2"
                        />
                        <span className="text-sm font-medium text-gray-700">
                          이메일 인증을 마쳐야 로그인할 수 있게 한다
                        </span>
                      </label>
                      <p className="mt-1 ml-6 text-xs text-amber-900">
                        켜면 인증하지 않은 주소로는 로그인이 거절되고, 거절 화면에서 인증 메일을
                        다시 받을 수 있습니다. 끄면 지금처럼 인증 여부와 상관없이 관리자 승인만으로
                        로그인됩니다.
                      </p>

                      {/*
                        켜기 전에 비용을 보여 준다. 이 스위치의 비용은 아무도
                        겪어 보고 나서야 알게 되는 형태라, 숫자가 화면에
                        없으면 "로그인이 안 된다"는 문의로 처음 알게 된다.
                      */}
                      <div className="mt-3 ml-6 rounded-md bg-white/70 p-3 text-xs">
                        {verificationCoverage ? (
                          <>
                            <p className="text-gray-800">
                              승인된 조합원 <strong>{verificationCoverage.approved}명</strong> 중{' '}
                              <strong className="text-amber-900">
                                {verificationCoverage.unverified}명
                              </strong>
                              이 아직 이메일 주소를 인증하지 않았습니다.
                            </p>
                            {verificationCoverage.unverified > 0 && (
                              <p className="mt-1 text-gray-600">
                                지금 켜면 그{' '}
                                {verificationCoverage.unverified -
                                  verificationCoverage.unverified_admins}
                                명이 다음 로그인부터 막힙니다.
                              </p>
                            )}
                            {verificationCoverage.unverified_admins > 0 && (
                              <p className="mt-1 text-gray-600">
                                그중 관리자 {verificationCoverage.unverified_admins}명은 막히지
                                않습니다(아래 참고).
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="text-gray-600">
                            미인증 회원 수를 확인하지 못했습니다. 켜기 전에 새로고침해 주세요.
                          </p>
                        )}
                      </div>

                      <p className="mt-3 ml-6 text-xs text-gray-600">
                        관리자는 이 관문에 걸리지 않습니다. 마지막 관리자의 주소가 인증되지 않은
                        채로 켜지면 스위치를 다시 끌 사람이 남지 않기 때문입니다.
                      </p>
                      <p className="mt-1 ml-6 text-xs text-gray-600">
                        설정을 읽지 못하면 관문은 열린 쪽으로 둡니다 — 데이터베이스가 한 번
                        삐끗했다고 전 조합원이 로그인하지 못하면 안 됩니다.
                      </p>
                    </div>
                  </div>
                )}

                {/* 기능 설정 */}
                {activeTab === 'features' && (
                  <div className="space-y-6">
                    <div>
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={settings.features.board_enabled}
                          onChange={e =>
                            updateSettings('features', 'board_enabled', e.target.checked)
                          }
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 mr-2"
                        />
                        <span className="text-sm font-medium text-gray-700">게시판 기능</span>
                      </label>
                      <p className="mt-1 ml-6 text-xs text-gray-500">
                        끄면 새 글이 올라오지 않습니다. 올라와 있는 글은 그대로 읽히고, 수정·삭제와
                        관리자 정리는 계속 됩니다.
                      </p>
                    </div>

                    <div>
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={settings.features.artist_registration_enabled}
                          onChange={e =>
                            updateSettings(
                              'features',
                              'artist_registration_enabled',
                              e.target.checked
                            )
                          }
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 mr-2"
                        />
                        <span className="text-sm font-medium text-gray-700">
                          아티스트 등록 허용
                        </span>
                      </label>
                      <p className="mt-1 ml-6 text-xs text-gray-500">
                        끄면 조합원이 아티스트 페이지를 새로 채우거나 고치지 못합니다. 공개된
                        아티스트 페이지는 그대로 보이고, 사무국의 아티스트 배정은 계속 됩니다.
                      </p>
                    </div>

                    <div>
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={settings.features.comments_enabled}
                          onChange={e =>
                            updateSettings('features', 'comments_enabled', e.target.checked)
                          }
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 mr-2"
                        />
                        <span className="text-sm font-medium text-gray-700">댓글 기능</span>
                      </label>
                      <p className="mt-1 ml-6 text-xs text-gray-500">
                        끄면 새 댓글이 달리지 않습니다. 달려 있는 댓글은 그대로 보이고 지울 수
                        있습니다.
                      </p>
                    </div>

                    <div>
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={settings.features.file_uploads_enabled}
                          onChange={e =>
                            updateSettings('features', 'file_uploads_enabled', e.target.checked)
                          }
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 mr-2"
                        />
                        <span className="text-sm font-medium text-gray-700">파일 업로드 허용</span>
                      </label>
                      <p className="mt-1 ml-6 text-xs text-gray-500">
                        끄면 조합원이 올리는 새 파일이 막힙니다 — 게시판 첨부·본문 이미지·아티스트
                        사진입니다. 올라가 있는 파일은 그대로 내려받힙니다. 펀딩 표지 이미지는 펀딩
                        스위치가 다스리므로 이것과 무관하고, 메일함 수신 첨부와 이사회 서류함도
                        영향을 받지 않습니다.
                      </p>
                    </div>

                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={settings.features.funding_enabled}
                          onChange={e =>
                            updateSettings('features', 'funding_enabled', e.target.checked)
                          }
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 mr-2"
                        />
                        <span className="text-sm font-medium text-gray-700">
                          펀딩 기능 — 새 프로젝트 개설·심사 승인·후원 결제 허용
                        </span>
                      </label>
                      <p className="mt-1 ml-6 text-xs text-amber-800">
                        켜면 조합원이 캠페인을 만들어 심사에 올릴 수 있고, 승인된 캠페인은 실제
                        결제로 후원을 받습니다. 끄면 <strong>새로 시작되는 것만</strong> 막힙니다 —
                        캠페인 개설(대리 개설 포함)·내용 수정·리워드 저장·제출과 심사 전이(승인·
                        마감·정산 표시), 그리고 후원 결제(준비·확정·후원자 직접 취소)입니다.
                      </p>
                      <p className="mt-1 ml-6 text-xs text-amber-800">
                        <strong>사무국의 뒷정리는 꺼져 있어도 그대로 됩니다</strong> — 대리
                        환불·정산 정리와 지급 표시·이행 표시 되돌리기. 이미 받은 돈을 돌려주는 길을
                        함께 닫으면 남는 수단이 토스 콘솔뿐이 되고, 콘솔에서 나간 환불은 원장이
                        모릅니다. 공개 페이지와 후원 내역 조회도 계속 보입니다.
                      </p>

                      <div className="mt-4 ml-6 border-t border-amber-200 pt-4">
                        <p className="text-sm font-medium text-gray-700">
                          플랫폼 수수료율 ({FEE_RATE_VAT_NOTE})
                        </p>
                        <p className="mt-1 text-xs text-amber-800">
                          모금액에서 조합이 떼는 몫입니다. 두 숫자 모두{' '}
                          <strong>{FEE_RATE_VAT_NOTE}</strong>이라 여기에 부가세를 다시 얹지
                          않습니다.
                        </p>

                        <div className="mt-3 grid gap-4 sm:grid-cols-2">
                          {(
                            [
                              ['funding_fee_rate_member_bp', '조합원 캠페인'],
                              ['funding_fee_rate_nonmember_bp', '비조합원 캠페인'],
                            ] as Array<[FeeRateField, string]>
                          ).map(([field, label]) => (
                            <div key={field}>
                              <label
                                className="block text-xs font-medium text-gray-700 mb-1"
                                htmlFor={field}
                              >
                                {label}
                              </label>
                              <div className="flex items-center">
                                <input
                                  id={field}
                                  type="text"
                                  inputMode="decimal"
                                  value={feeRateInputs[field]}
                                  onChange={e => updateFeeRate(field, e.target.value)}
                                  className={`w-24 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 ${
                                    feeRateErrors[field]
                                      ? 'border-red-300 focus:ring-red-500'
                                      : 'border-gray-300 focus:ring-primary-500'
                                  }`}
                                />
                                <span className="ml-2 text-sm text-gray-700">%</span>
                              </div>
                              {feeRateErrors[field] && (
                                <p className="mt-1 text-xs text-red-600">{feeRateErrors[field]}</p>
                              )}
                            </div>
                          ))}
                        </div>

                        {/*
                          요율은 **승인하는 순간 캠페인에 새겨진다**
                          (`src/lib/funding/feeRate.ts`의 `platformFeeRateFor`를
                          승인 라우트가 부르고, 그 결과를 캠페인 행에 적는다).
                          그래서 여기서 숫자를 바꿔도 이미 승인된 캠페인의 정산은
                          움직이지 않는다. 이 문장을 화면에 적어 두지 않으면
                          사무국은 "요율을 내렸으니 진행 중인 캠페인도 내려간다"고
                          읽는다 — 그 오해는 후원자에게 돌려줄 금액을 잘못 계산하게
                          만든다.
                        */}
                        <p className="mt-3 text-xs text-amber-900">
                          바꾼 요율은 <strong>앞으로 승인하는 캠페인부터</strong> 적용됩니다. 요율은
                          승인하는 순간 캠페인에 새겨지므로, 이미 승인된 캠페인의 정산은 여기서
                          숫자를 바꿔도 달라지지 않습니다.
                        </p>
                        <p className="mt-1 text-xs text-gray-600">
                          비조합원 요율은 펀딩 심사 화면의 대리 개설로 조합원이 아닌 회원을 개설자로
                          지정한 캠페인에 붙습니다.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* 백업/복원 설정 */}
                {activeTab === 'backup' && (
                  <div className="space-y-8">
                    {/* 경고 메시지 */}
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                      <div className="flex items-start">
                        <FiAlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 mr-2 flex-shrink-0" />
                        <div>
                          <h4 className="text-sm font-medium text-amber-800">주의사항</h4>
                          <ul className="text-sm text-amber-700 mt-2 list-disc list-inside space-y-1">
                            <li>백업 복원 시 현재 설정이 모두 덮어쓰여집니다.</li>
                            <li>복원 전에 반드시 현재 설정을 백업하시기 바랍니다.</li>
                            <li>
                              민감한 정보(비밀번호 등)가 포함되므로 백업 파일 보안에 주의하세요.
                            </li>
                          </ul>
                        </div>
                      </div>
                    </div>

                    {/* 백업 다운로드 */}
                    <div className="bg-white border border-gray-200 rounded-lg p-6">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                        <FiDownload className="w-5 h-5 mr-2 text-blue-600" />
                        설정 백업
                      </h3>
                      <p className="text-sm text-gray-600 mb-4">
                        현재 시스템 설정을 JSON 파일로 다운로드합니다. 설정 변경 전이나 정기적으로
                        백업하시기 바랍니다.
                      </p>
                      <button
                        onClick={downloadBackup}
                        disabled={backupLoading}
                        className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <FiDownload
                          className={`w-4 h-4 mr-2 ${backupLoading ? 'animate-pulse' : ''}`}
                        />
                        {backupLoading ? '백업 생성 중...' : '백업 다운로드'}
                      </button>
                    </div>

                    {/* 백업 복원 */}
                    <div className="bg-white border border-gray-200 rounded-lg p-6">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                        <FiUpload className="w-5 h-5 mr-2 text-green-600" />
                        설정 복원
                      </h3>
                      <p className="text-sm text-gray-600 mb-4">
                        백업된 JSON 파일에서 설정을 복원합니다. 복원하면 현재 설정이 모두 바뀌니
                        주의하시기 바랍니다.
                      </p>

                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json"
                        onChange={handleFileSelect}
                        className="hidden"
                      />

                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={restoreLoading}
                        className="flex items-center px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <FiUpload
                          className={`w-4 h-4 mr-2 ${restoreLoading ? 'animate-pulse' : ''}`}
                        />
                        {restoreLoading ? '복원 중...' : '백업 파일 선택'}
                      </button>
                    </div>

                    {/* 기본값 복원 */}
                    <div className="bg-white border border-gray-200 rounded-lg p-6">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                        <FiRotateCcw className="w-5 h-5 mr-2 text-orange-600" />
                        기본값 복원
                      </h3>
                      <p className="text-sm text-gray-600 mb-4">
                        모든 설정을 시스템 기본값으로 되돌립니다. 이 작업은 되돌릴 수 없으니 신중히
                        결정하시기 바랍니다.
                      </p>
                      <button
                        onClick={resetToDefaults}
                        disabled={restoreLoading}
                        className="flex items-center px-4 py-2 bg-orange-600 text-white rounded-md hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <FiRotateCcw
                          className={`w-4 h-4 mr-2 ${restoreLoading ? 'animate-spin' : ''}`}
                        />
                        {restoreLoading ? '복원 중...' : '기본값으로 복원'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* 저장 버튼 */}
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200">
            <button
              onClick={fetchSettings}
              disabled={loading}
              className="flex items-center px-4 py-2 text-gray-600 hover:text-gray-800 disabled:opacity-50"
            >
              <FiRefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              새로고침
            </button>

            <button
              onClick={saveSettings}
              disabled={saving || !settings}
              className="flex items-center px-6 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
            >
              <FiSave className="w-4 h-4 mr-2" />
              {saving ? '저장 중...' : '설정 저장'}
            </button>
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}
