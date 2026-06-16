'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from '@/i18n/navigation'
import MypageLayout from '../components/MypageLayout'
import PermissionCheck from '../components/PermissionCheck'
import ArtistEditForm from './components/ArtistEditForm'
import { DatabaseArtist } from '@/types'
import { isProjectStoragePublicUrl } from '@/utils/storageUrlValidation'

export default function ArtistPage() {
  const [artist, setArtist] = useState<DatabaseArtist | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  const fetchArtist = useCallback(async () => {
    try {
      // API를 통해 아티스트 정보 조회
      const response = await fetch('/api/mypage/artist', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      })

      if (!response.ok) {
        if (response.status === 401) {
          router.push('/login')
          return
        }

        const errorData = await response.json()
        throw new Error(errorData.error || '아티스트 정보를 불러오는데 실패했습니다.')
      }

      const data = await response.json()
      setArtist(data.artist)
    } catch (error: any) {
      console.error('Error fetching artist:', error)
      setError(error.message || '아티스트 정보를 불러오는데 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    fetchArtist()
  }, [fetchArtist])

  const handleUpdate = async (updates: Partial<DatabaseArtist>) => {
    if (!artist) return

    setSaving(true)
    setError(null)

    try {
      // API를 통해 아티스트 정보 업데이트
      const response = await fetch('/api/mypage/artist', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(updates),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || '아티스트 프로필 업데이트에 실패했습니다.')
      }

      const data = await response.json()

      // 업데이트된 아티스트 정보로 상태 업데이트
      setArtist(data.artist)

      setSuccessMessage('아티스트 프로필이 성공적으로 업데이트되었습니다.')
    } catch (error: any) {
      console.error('Artist update error:', error)
      setError(error.message || '아티스트 프로필 업데이트에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (!successMessage) return
    const timer = setTimeout(() => setSuccessMessage(null), 4000)
    return () => clearTimeout(timer)
  }, [successMessage])

  if (loading) {
    return (
      <MypageLayout
        title="아티스트 프로필"
        description="아티스트 정보와 포트폴리오를 관리할 수 있습니다."
      >
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      </MypageLayout>
    )
  }

  const previewImageForDisplay =
    artist?.profile_photo_url ||
    artist?.profile_photo_metadata?.variant_urls?.webp ||
    artist?.profile_photo_metadata?.variant_urls?.fallback ||
    artist?.profile_photo_metadata?.variant_urls?.original ||
    ''
  const safePreviewImageForDisplay =
    artist && isProjectStoragePublicUrl(previewImageForDisplay, 'artists', artist.id)
      ? previewImageForDisplay
      : ''

  return (
    <PermissionCheck
      requiredPermission="artist"
      redirectTo="/mypage"
      fallback={
        <MypageLayout
          title="아티스트 프로필"
          description="아티스트 정보와 포트폴리오를 관리할 수 있습니다."
        >
          <div className="text-center py-12">
            <div className="text-gray-500 mb-4">
              <svg
                className="mx-auto h-12 w-12 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">아티스트 권한 필요</h3>
            <p className="text-gray-600 text-sm mb-4">
              이 페이지에 접근하려면 아티스트 권한이 필요합니다.
              <br />
              관리자에게 아티스트 권한 요청을 문의해 주세요.
            </p>
            <button onClick={() => router.push('/connect')} className="tw-btn-primary">
              문의하기
            </button>
          </div>
        </MypageLayout>
      }
    >
      <MypageLayout
        title="아티스트 프로필"
        description="아티스트 정보와 포트폴리오를 관리할 수 있습니다."
      >
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-md">
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}

        {successMessage && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-md">
            <p className="text-green-700 text-sm">{successMessage}</p>
          </div>
        )}

        {artist ? (
          <div className="space-y-6">
            {/* 아티스트 기본 정보 표시 */}
            <div className="bg-gradient-to-r from-primary-50 to-accent-50 rounded-lg p-6 border border-gray-200">
              <div className="flex items-start space-x-4">
                {safePreviewImageForDisplay && (
                  <div className="flex-shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={safePreviewImageForDisplay}
                      alt={artist.name}
                      className="w-16 h-16 rounded-lg object-cover"
                    />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h2 className="text-xl font-semibold text-gray-900 mb-2">{artist.name}</h2>
                  <p className="text-gray-600 text-sm mb-2">{artist.one_liner}</p>
                  <div className="flex flex-wrap gap-2">
                    {artist.category?.map((cat, index) => (
                      <span
                        key={index}
                        className="inline-block px-2 py-1 text-xs bg-primary-100 text-primary-700 rounded"
                      >
                        {cat}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* 편집 폼 */}
            <ArtistEditForm artist={artist} onUpdate={handleUpdate} loading={saving} />
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-gray-500">아티스트 정보를 불러올 수 없습니다.</p>
            <button onClick={() => window.location.reload()} className="mt-4 tw-btn-secondary">
              다시 시도
            </button>
          </div>
        )}
      </MypageLayout>
    </PermissionCheck>
  )
}
