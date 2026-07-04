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
  }
}

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<AdminSettings | null>(null)
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
    } catch (err) {
      console.error('Settings fetch error:', err)
      setError(err instanceof Error ? err.message : '설정 정보를 불러오는 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const saveSettings = async () => {
    if (!settings) return

    try {
      setSaving(true)
      clearStatusTimer()
      setError(null)
      setSuccess(null)

      // 저장 전 전체 설정 유효성 검증
      const validationResult = validateAllSettings(settings)
      if (!validationResult.isValid) {
        setValidationErrors(validationResult.errors)
        throw new Error(
          `설정에 오류가 있습니다: ${validationResult.errors.map(e => e.message).join(', ')}`
        )
      }

      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(settings),
      })

      if (!response.ok) {
        throw new Error('설정 저장 중 오류가 발생했습니다.')
      }

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

                {/* 이메일 설정 */}
                {activeTab === 'email' && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          SMTP 호스트
                        </label>
                        <input
                          type="text"
                          value={settings.email.smtp_host}
                          onChange={e => updateSettings('email', 'smtp_host', e.target.value)}
                          className={getFieldClassName(
                            'email',
                            'smtp_host',
                            'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500'
                          )}
                        />
                        {getFieldError('email', 'smtp_host') && (
                          <p className="mt-1 text-sm text-red-600">
                            {getFieldError('email', 'smtp_host')}
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          SMTP 포트
                        </label>
                        <input
                          type="number"
                          value={settings.email.smtp_port}
                          onChange={e =>
                            updateSettings(
                              'email',
                              'smtp_port',
                              parseIntegerParam(e.target.value, 0, { min: 0 })
                            )
                          }
                          className={getFieldClassName(
                            'email',
                            'smtp_port',
                            'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500'
                          )}
                        />
                        {getFieldError('email', 'smtp_port') && (
                          <p className="mt-1 text-sm text-red-600">
                            {getFieldError('email', 'smtp_port')}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          SMTP 사용자명
                        </label>
                        <input
                          type="text"
                          value={settings.email.smtp_user}
                          onChange={e => updateSettings('email', 'smtp_user', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          SMTP 비밀번호
                        </label>
                        <input
                          type="password"
                          value={settings.email.smtp_password}
                          onChange={e => updateSettings('email', 'smtp_password', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          발신자 이메일
                        </label>
                        <input
                          type="email"
                          value={settings.email.from_email}
                          onChange={e => updateSettings('email', 'from_email', e.target.value)}
                          className={getFieldClassName(
                            'email',
                            'from_email',
                            'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500'
                          )}
                        />
                        {getFieldError('email', 'from_email') && (
                          <p className="mt-1 text-sm text-red-600">
                            {getFieldError('email', 'from_email')}
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          발신자 이름
                        </label>
                        <input
                          type="text"
                          value={settings.email.from_name}
                          onChange={e => updateSettings('email', 'from_name', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* 보안 설정 */}
                {activeTab === 'security' && (
                  <div className="space-y-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        세션 타임아웃 (분)
                      </label>
                      <input
                        type="number"
                        value={settings.security.session_timeout}
                        onChange={e =>
                          updateSettings(
                            'security',
                            'session_timeout',
                            parseIntegerParam(e.target.value, 0, { min: 0 })
                          )
                        }
                        className={getFieldClassName(
                          'security',
                          'session_timeout',
                          'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500'
                        )}
                      />
                      {getFieldError('security', 'session_timeout') && (
                        <p className="mt-1 text-sm text-red-600">
                          {getFieldError('security', 'session_timeout')}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        최대 로그인 시도 횟수
                      </label>
                      <input
                        type="number"
                        value={settings.security.max_login_attempts}
                        onChange={e =>
                          updateSettings(
                            'security',
                            'max_login_attempts',
                            parseIntegerParam(e.target.value, 0, { min: 0 })
                          )
                        }
                        className={getFieldClassName(
                          'security',
                          'max_login_attempts',
                          'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500'
                        )}
                      />
                      {getFieldError('security', 'max_login_attempts') && (
                        <p className="mt-1 text-sm text-red-600">
                          {getFieldError('security', 'max_login_attempts')}
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        최소 비밀번호 길이
                      </label>
                      <input
                        type="number"
                        value={settings.security.password_min_length}
                        onChange={e =>
                          updateSettings(
                            'security',
                            'password_min_length',
                            parseIntegerParam(e.target.value, 0, { min: 0 })
                          )
                        }
                        className={getFieldClassName(
                          'security',
                          'password_min_length',
                          'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500'
                        )}
                      />
                      {getFieldError('security', 'password_min_length') && (
                        <p className="mt-1 text-sm text-red-600">
                          {getFieldError('security', 'password_min_length')}
                        </p>
                      )}
                    </div>

                    <div>
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
                        <span className="text-sm font-medium text-gray-700">이메일 인증 필수</span>
                      </label>
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
