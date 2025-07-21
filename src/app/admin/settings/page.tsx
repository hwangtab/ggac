'use client'

import { useState, useEffect } from 'react'
import { FiSave, FiSettings, FiMail, FiShield, FiGlobe, FiDatabase, FiRefreshCw } from 'react-icons/fi'
import AdminLayout from '../components/AdminLayout'

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
  const [activeTab, setActiveTab] = useState<'site' | 'email' | 'security' | 'features'>('site')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    fetchSettings()
  }, [])

  const fetchSettings = async () => {
    try {
      setLoading(true)
      setError(null)
      
      const response = await fetch('/api/admin/settings')
      if (!response.ok) {
        throw new Error('설정 정보를 불러오는 중 오류가 발생했습니다.')
      }
      
      const data = await response.json()
      setSettings(data)
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
      setError(null)
      setSuccess(null)

      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(settings)
      })

      if (!response.ok) {
        throw new Error('설정 저장 중 오류가 발생했습니다.')
      }

      setSuccess('설정이 성공적으로 저장되었습니다.')
      setTimeout(() => setSuccess(null), 3000)
    } catch (err) {
      console.error('Settings save error:', err)
      setError(err instanceof Error ? err.message : '설정 저장 중 오류가 발생했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const updateSettings = (section: keyof AdminSettings, key: string, value: any) => {
    if (!settings) return
    setSettings({
      ...settings,
      [section]: {
        ...settings[section],
        [key]: value
      }
    })
  }

  const tabs = [
    { id: 'site', label: '사이트 설정', icon: FiGlobe },
    { id: 'email', label: '이메일 설정', icon: FiMail },
    { id: 'security', label: '보안 설정', icon: FiShield },
    { id: 'features', label: '기능 설정', icon: FiSettings },
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

        {/* 탭 네비게이션 */}
        <div className="bg-white rounded-lg border border-gray-200">
          <div className="border-b border-gray-200">
            <nav className="flex space-x-8 px-6">
              {tabs.map((tab) => (
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
                          onChange={(e) => updateSettings('site', 'maintenance_mode', e.target.checked)}
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 mr-2"
                        />
                        <span className="text-sm font-medium text-gray-700">유지보수 모드</span>
                      </label>
                      <p className="text-xs text-gray-500 ml-6">활성화 시 관리자만 사이트 접근 가능</p>
                    </div>

                    <div>
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={settings.site.registration_enabled}
                          onChange={(e) => updateSettings('site', 'registration_enabled', e.target.checked)}
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 mr-2"
                        />
                        <span className="text-sm font-medium text-gray-700">회원 가입 허용</span>
                      </label>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">사이트 제목</label>
                      <input
                        type="text"
                        value={settings.site.site_title}
                        onChange={(e) => updateSettings('site', 'site_title', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">사이트 설명</label>
                      <textarea
                        value={settings.site.site_description}
                        onChange={(e) => updateSettings('site', 'site_description', e.target.value)}
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">최대 회원 수</label>
                      <input
                        type="number"
                        value={settings.site.max_members}
                        onChange={(e) => updateSettings('site', 'max_members', parseInt(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                  </div>
                )}

                {/* 이메일 설정 */}
                {activeTab === 'email' && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">SMTP 호스트</label>
                        <input
                          type="text"
                          value={settings.email.smtp_host}
                          onChange={(e) => updateSettings('email', 'smtp_host', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">SMTP 포트</label>
                        <input
                          type="number"
                          value={settings.email.smtp_port}
                          onChange={(e) => updateSettings('email', 'smtp_port', parseInt(e.target.value))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">SMTP 사용자명</label>
                        <input
                          type="text"
                          value={settings.email.smtp_user}
                          onChange={(e) => updateSettings('email', 'smtp_user', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">SMTP 비밀번호</label>
                        <input
                          type="password"
                          value={settings.email.smtp_password}
                          onChange={(e) => updateSettings('email', 'smtp_password', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">발신자 이메일</label>
                        <input
                          type="email"
                          value={settings.email.from_email}
                          onChange={(e) => updateSettings('email', 'from_email', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">발신자 이름</label>
                        <input
                          type="text"
                          value={settings.email.from_name}
                          onChange={(e) => updateSettings('email', 'from_name', e.target.value)}
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
                      <label className="block text-sm font-medium text-gray-700 mb-1">세션 타임아웃 (분)</label>
                      <input
                        type="number"
                        value={settings.security.session_timeout}
                        onChange={(e) => updateSettings('security', 'session_timeout', parseInt(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">최대 로그인 시도 횟수</label>
                      <input
                        type="number"
                        value={settings.security.max_login_attempts}
                        onChange={(e) => updateSettings('security', 'max_login_attempts', parseInt(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">최소 비밀번호 길이</label>
                      <input
                        type="number"
                        value={settings.security.password_min_length}
                        onChange={(e) => updateSettings('security', 'password_min_length', parseInt(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>

                    <div>
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={settings.security.require_email_verification}
                          onChange={(e) => updateSettings('security', 'require_email_verification', e.target.checked)}
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
                          onChange={(e) => updateSettings('features', 'board_enabled', e.target.checked)}
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
                          onChange={(e) => updateSettings('features', 'artist_registration_enabled', e.target.checked)}
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 mr-2"
                        />
                        <span className="text-sm font-medium text-gray-700">아티스트 등록 허용</span>
                      </label>
                    </div>

                    <div>
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={settings.features.comments_enabled}
                          onChange={(e) => updateSettings('features', 'comments_enabled', e.target.checked)}
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
                          onChange={(e) => updateSettings('features', 'file_uploads_enabled', e.target.checked)}
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 mr-2"
                        />
                        <span className="text-sm font-medium text-gray-700">파일 업로드 허용</span>
                      </label>
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