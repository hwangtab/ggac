'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from '@/i18n/navigation'
import MypageLayout from '../components/MypageLayout'
import PermissionCheck from '../components/PermissionCheck'
import ProfileEditForm from './components/ProfileEditForm'
import activityLogger from '@/utils/activityLogger'
import { MemberProfile } from '@/types'

export default function ProfilePage() {
  const [profile, setProfile] = useState<MemberProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  const fetchProfile = useCallback(async () => {
    try {
      const response = await fetch('/api/mypage/profile', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      })
      const result = (await response.json().catch(() => null)) as {
        success?: boolean
        data?: { profile?: MemberProfile }
        error?: string
      } | null

      if (response.status === 401) {
        router.push('/login')
        return
      }

      if (!response.ok || !result?.success || !result.data?.profile) {
        throw new Error(result?.error || '프로필을 불러오는데 실패했습니다.')
      }

      setProfile(result.data.profile)
    } catch (error) {
      console.error('Error fetching profile:', error)
      setError('프로필을 불러오는데 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    fetchProfile()
  }, [fetchProfile])

  const handleUpdate = async (updates: Partial<MemberProfile>) => {
    if (!profile) return

    setSaving(true)
    setError(null)

    try {
      const response = await fetch('/api/mypage/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      })
      const result = (await response.json().catch(() => null)) as {
        success?: boolean
        data?: { profile?: MemberProfile }
        error?: string
      } | null

      if (!response.ok || !result?.success || !result.data?.profile) {
        throw new Error(result?.error || '프로필 업데이트에 실패했습니다.')
      }

      // 프로필 업데이트 활동 로깅
      try {
        await activityLogger.logProfileUpdated('member_profile', {
          updatedFields: Object.keys(updates),
        })
      } catch (activityError) {
        console.debug('Profile update activity logging failed:', activityError)
      }

      setProfile(result.data.profile)

      // 성공 알림 (간단한 상태로)
      alert('프로필이 성공적으로 업데이트되었습니다.')
    } catch (error: any) {
      console.error('Profile update error:', error)
      setError(error.message || '프로필 업데이트에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <MypageLayout
        title="개인 프로필"
        description="개인 정보 및 조합 관련 정보를 수정할 수 있습니다."
      >
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      </MypageLayout>
    )
  }

  return (
    <PermissionCheck requiredPermission="member" redirectTo="/register/pending">
      <MypageLayout
        title="개인 프로필"
        description="개인 정보 및 조합 관련 정보를 수정할 수 있습니다."
      >
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-md">
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}

        {profile ? (
          <ProfileEditForm profile={profile} onUpdate={handleUpdate} loading={saving} />
        ) : (
          <div className="text-center py-8">
            <p className="text-gray-500">프로필을 불러올 수 없습니다.</p>
            <button onClick={() => router.refresh()} className="mt-4 tw-btn-secondary">
              다시 시도
            </button>
          </div>
        )}
      </MypageLayout>
    </PermissionCheck>
  )
}
