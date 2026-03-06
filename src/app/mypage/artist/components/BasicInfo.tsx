'use client'

import { FiUser } from 'react-icons/fi'
import ProfilePhotoUploader from '@/components/ProfilePhotoUploader'
import type { ProfilePhotoUploadResponse, ProfilePhotoMetadata } from '@/types'

interface BasicInfoProps {
  data: {
    name: string
    category: string[]
    one_liner: string
    template_type: string
    profile_photo_url: string | null
    profile_photo_metadata?: ProfilePhotoMetadata
  }
  errors: Record<string, string>
  onChange: (field: string, value: any) => void
}

const BasicInfo: React.FC<BasicInfoProps> = ({ data, errors, onChange }) => {
  const categoryOptions = [
    '창작자',
    '기획자',
    '연주자',
    '프로듀서',
    '엔지니어',
    '작사가',
    '작곡가',
    '편곡가',
    '사운드 디자이너',
    '비주얼 아티스트',
    '퍼포머',
    '기타',
  ]

  const templateOptions = [
    { value: '미니멀형', label: '미니멀형 - 깔끔하고 간결한 레이아웃' },
    { value: '콜라주형', label: '콜라주형 - 풍부한 시각적 요소와 이미지' },
  ]

  const handleCategoryChange = (category: string, checked: boolean) => {
    const newCategories = checked
      ? [...data.category, category]
      : data.category.filter(c => c !== category)
    onChange('category', newCategories)
  }

  // 프로필 사진 업로드 완료 핸들러
  const handlePhotoUploadComplete = (response: ProfilePhotoUploadResponse) => {
    onChange('profile_photo_url', response.photo_url)
    onChange('profile_photo_metadata', response.metadata)
  }

  // 프로필 사진 삭제 핸들러
  const handlePhotoDelete = () => {
    onChange('profile_photo_url', null)
    onChange('profile_photo_metadata', undefined)
  }

  return (
    <div className="bg-gray-50 rounded-lg p-6">
      <div className="flex items-center mb-6">
        <FiUser className="w-5 h-5 text-primary-600 mr-3" />
        <h2 className="text-lg font-semibold text-gray-900">기본 정보</h2>
      </div>

      <div className="space-y-6">
        {/* 아티스트 프로필 사진 */}
        <div>
          <div className="mb-4">
            <h3 className="text-sm font-medium text-gray-700 mb-2">아티스트 프로필 사진</h3>
            <p className="text-xs text-gray-500">
              공개 아티스트 페이지에 표시될 대표 사진입니다. 개인 프로필에서도 이 사진이 표시됩니다.
            </p>
          </div>
          <div className="w-full flex justify-center items-center mb-4">
            <div className="flex flex-col items-center text-center">
              <ProfilePhotoUploader
                currentPhotoUrl={data.profile_photo_url}
                currentMetadata={data.profile_photo_metadata}
                userDisplayName={data.name || 'Artist'}
                onUploadComplete={handlePhotoUploadComplete}
                onPhotoDelete={handlePhotoDelete}
                size="large"
              />
              <p className="mt-2 text-sm text-gray-500 text-center">최대 2MB, JPEG/PNG/WebP/GIF</p>
            </div>
          </div>
          {errors.profile_photo_url && (
            <p className="mt-2 text-sm text-red-600">{errors.profile_photo_url}</p>
          )}
        </div>

        {/* 아티스트 이름 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">아티스트 이름 *</label>
          <input
            type="text"
            value={data.name}
            onChange={e => onChange('name', e.target.value)}
            className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 ${
              errors.name
                ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                : 'border-gray-300'
            }`}
            placeholder="아티스트 이름을 입력하세요"
          />
          {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name}</p>}
        </div>

        {/* 카테고리 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            카테고리 * (복수 선택 가능)
          </label>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {categoryOptions.map(category => (
              <label key={category} className="flex items-center">
                <input
                  type="checkbox"
                  checked={data.category.includes(category)}
                  onChange={e => handleCategoryChange(category, e.target.checked)}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <span className="ml-2 text-sm text-gray-700">{category}</span>
              </label>
            ))}
          </div>
          {errors.category && <p className="mt-1 text-xs text-red-600">{errors.category}</p>}
          <p className="mt-1 text-xs text-gray-500">
            자신의 역할과 관련된 카테고리를 선택해주세요.
          </p>
        </div>

        {/* 한 줄 소개 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">한 줄 소개 *</label>
          <input
            type="text"
            value={data.one_liner}
            onChange={e => onChange('one_liner', e.target.value)}
            maxLength={100}
            className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 ${
              errors.one_liner
                ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                : 'border-gray-300'
            }`}
            placeholder="자신을 한 줄로 표현해보세요"
          />
          <div className="flex justify-between items-center mt-1">
            {errors.one_liner ? (
              <p className="text-xs text-red-600">{errors.one_liner}</p>
            ) : (
              <p className="text-xs text-gray-500">
                간단하게 자신의 음악이나 예술 활동을 소개해주세요.
              </p>
            )}
            <span className="text-xs text-gray-400">{data.one_liner.length}/100</span>
          </div>
        </div>

        {/* 템플릿 타입 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            프로필 페이지 스타일
          </label>
          <div className="space-y-3">
            {templateOptions.map(template => (
              <label key={template.value} className="flex items-start">
                <input
                  type="radio"
                  name="template_type"
                  value={template.value}
                  checked={data.template_type === template.value}
                  onChange={e => onChange('template_type', e.target.value)}
                  className="mt-1 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                <div className="ml-3">
                  <div className="text-sm font-medium text-gray-900">
                    {template.label.split(' - ')[0]}
                  </div>
                  <div className="text-xs text-gray-500">{template.label.split(' - ')[1]}</div>
                </div>
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            아티스트 페이지의 레이아웃 스타일을 선택해주세요.
          </p>
        </div>
      </div>
    </div>
  )
}

export default BasicInfo
