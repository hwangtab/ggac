'use client'

import { useState, useEffect } from 'react'
import { FiUser, FiEdit3 } from 'react-icons/fi'
import { Link } from '@/i18n/navigation'
import type { ProfilePhotoMetadata } from '@/types'
import { logicalPathFromUrl } from '@/lib/storage/paths'

interface PersonalInfoProps {
  data: {
    display_name: string
    phone_number: string
    birth_date: string
  }
  artistId?: string | null
  artistPhotoUrl?: string | null
  artistPhotoMetadata?: ProfilePhotoMetadata
  hasArtistPermission: boolean
  errors: Record<string, string>
  onChange: (field: string, value: any) => void
  readOnlyEmail: string
}

const PersonalInfo: React.FC<PersonalInfoProps> = ({
  data,
  artistId,
  artistPhotoUrl,
  artistPhotoMetadata,
  hasArtistPermission,
  errors,
  onChange,
  readOnlyEmail,
}) => {
  // `artistId`로 받는 값은 **`legacy_id`(`artist-016` 꼴)여야 한다.** 사진의
  // 저장 경로를 만드는 것은 업로드 라우트의 `member_profiles.artist_id`이고, 그
  // 값이 legacy_id다. `artists.id`(UUID)를 넘기면 이 게이트가 모든 아티스트에
  // 대해 영구히 false가 되어 **사진이 아무 에러 없이 기본 아이콘으로 사라진다**
  // (2026-09-01 적대 감사에서 실제로 그 상태였다).
  const safeArtistPhotoUrl =
    artistPhotoUrl && artistId && logicalPathFromUrl(artistPhotoUrl, 'artists', artistId) !== null
      ? artistPhotoUrl
      : null

  return (
    <div className="bg-gray-50 rounded-lg p-6">
      <div className="flex items-center mb-6">
        <FiUser className="w-5 h-5 text-primary-600 mr-3" />
        <h2 className="text-lg font-semibold text-gray-900">개인 정보</h2>
      </div>

      {/* 프로필 사진 섹션 */}
      <div className="mb-6 w-full flex justify-center items-center">
        <div className="flex flex-col items-center text-center">
          {/* 프로필 사진 표시 */}
          <div className="relative w-32 h-32 rounded-full overflow-hidden border-2 border-gray-200 bg-gray-100">
            {safeArtistPhotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={safeArtistPhotoUrl}
                alt={`${data.display_name}의 프로필 사진`}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <FiUser className="w-12 h-12 text-gray-400" />
              </div>
            )}
          </div>

          <div className="mt-3 text-center">
            {hasArtistPermission ? (
              <div>
                <p className="text-sm text-gray-600 mb-2">아티스트 프로필 사진이 표시됩니다</p>
                <Link
                  href="/mypage/artist"
                  className="inline-flex items-center text-sm text-primary-600 hover:text-primary-700"
                >
                  <FiEdit3 className="w-4 h-4 mr-1" />
                  아티스트 프로필에서 사진 관리
                </Link>
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                아티스트 권한이 있으면 프로필 사진을 설정할 수 있습니다
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 이메일 (읽기 전용) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">이메일</label>
          <input
            type="email"
            value={readOnlyEmail}
            disabled
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-gray-100 text-gray-500 cursor-not-allowed"
          />
          <p className="mt-1 text-xs text-gray-500">이메일은 변경할 수 없습니다.</p>
        </div>

        {/* 표시 이름 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">표시 이름 *</label>
          <input
            type="text"
            value={data.display_name}
            onChange={e => onChange('display_name', e.target.value)}
            className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 ${
              errors.display_name
                ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                : 'border-gray-300'
            }`}
            placeholder="홍길동"
          />
          {errors.display_name && (
            <p className="mt-1 text-xs text-red-600">{errors.display_name}</p>
          )}
        </div>

        {/* 전화번호 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">전화번호 *</label>
          <input
            type="tel"
            value={data.phone_number}
            onChange={e => onChange('phone_number', e.target.value)}
            className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 ${
              errors.phone_number
                ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                : 'border-gray-300'
            }`}
            placeholder="010-1234-5678"
          />
          {errors.phone_number && (
            <p className="mt-1 text-xs text-red-600">{errors.phone_number}</p>
          )}
        </div>

        {/* 생년월일 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">생년월일</label>
          <input
            type="date"
            value={data.birth_date}
            onChange={e => onChange('birth_date', e.target.value)}
            className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 ${
              errors.birth_date
                ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                : 'border-gray-300'
            }`}
          />
          {errors.birth_date && <p className="mt-1 text-xs text-red-600">{errors.birth_date}</p>}
          <p className="mt-1 text-xs text-gray-500">선택사항입니다.</p>
        </div>
      </div>
    </div>
  )
}

export default PersonalInfo
