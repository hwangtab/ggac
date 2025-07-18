'use client'

import { useState } from 'react'
import { DatabaseArtist } from '@/types'
import BasicInfo from './BasicInfo'
import BioEditor from './BioEditor'
import PortfolioLinks from './PortfolioLinks'
import YoutubeVideos from './YoutubeVideos'

interface ArtistEditFormProps {
  artist: DatabaseArtist
  onUpdate: (updates: Partial<DatabaseArtist>) => Promise<void>
  loading: boolean
}

const ArtistEditForm: React.FC<ArtistEditFormProps> = ({ 
  artist, 
  onUpdate,
  loading
}) => {
  const [formData, setFormData] = useState({
    name: artist.name || '',
    category: artist.category || [],
    one_liner: artist.one_liner || '',
    bio: artist.bio || '',
    template_type: artist.template_type || '콜라주형',
    profile_image: artist.profile_image || '',
    portfolio_links: artist.portfolio_links || [],
    youtube_videos: artist.youtube_videos || [],
    contact: artist.contact || ''
  })

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isDirty, setIsDirty] = useState(false)

  const handleChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    setIsDirty(true)
    
    // 에러 클리어
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }))
    }
  }

  const validateForm = () => {
    const newErrors: Record<string, string> = {}

    if (!formData.name.trim()) {
      newErrors.name = '아티스트 이름은 필수입니다.'
    }

    if (!formData.one_liner.trim()) {
      newErrors.one_liner = '한 줄 소개는 필수입니다.'
    } else if (formData.one_liner.length > 100) {
      newErrors.one_liner = '한 줄 소개는 100자 이내로 입력해주세요.'
    }

    if (!formData.bio.trim()) {
      newErrors.bio = '아티스트 소개는 필수입니다.'
    }

    if (!formData.category || formData.category.length === 0) {
      newErrors.category = '최소 하나의 카테고리를 선택해주세요.'
    }

    // 포트폴리오 링크 검증
    if (formData.portfolio_links) {
      formData.portfolio_links.forEach((link, index) => {
        if (link.title && !link.url) {
          newErrors[`portfolio_${index}_url`] = '링크 URL을 입력해주세요.'
        }
        if (link.url && !link.title) {
          newErrors[`portfolio_${index}_title`] = '링크 제목을 입력해주세요.'
        }
        if (link.url && !/^https?:\/\/.+/.test(link.url)) {
          newErrors[`portfolio_${index}_url`] = '올바른 URL 형식을 입력해주세요.'
        }
      })
    }

    // 유튜브 동영상 검증
    if (formData.youtube_videos) {
      formData.youtube_videos.forEach((video, index) => {
        if (video.title && !video.url) {
          newErrors[`youtube_${index}_url`] = '동영상 URL을 입력해주세요.'
        }
        if (video.url && !video.title) {
          newErrors[`youtube_${index}_title`] = '동영상 제목을 입력해주세요.'
        }
        if (video.url && !/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/.+/.test(video.url)) {
          newErrors[`youtube_${index}_url`] = '올바른 YouTube URL을 입력해주세요.'
        }
      })
    }

    // 연락처 검증 (선택사항이지만 입력된 경우 이메일 형식 확인)
    if (formData.contact && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.contact)) {
      newErrors.contact = '올바른 이메일 형식을 입력해주세요.'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateForm()) {
      return
    }

    try {
      await onUpdate(formData)
      setIsDirty(false)
    } catch (error) {
      console.error('Form submission error:', error)
    }
  }

  const handleReset = () => {
    setFormData({
      name: artist.name || '',
      category: artist.category || [],
      one_liner: artist.one_liner || '',
      bio: artist.bio || '',
      template_type: artist.template_type || '콜라주형',
      profile_image: artist.profile_image || '',
      portfolio_links: artist.portfolio_links || [],
      youtube_videos: artist.youtube_videos || [],
      contact: artist.contact || ''
    })
    setErrors({})
    setIsDirty(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* 기본 정보 */}
      <BasicInfo 
        data={formData}
        errors={errors}
        onChange={handleChange}
      />

      {/* 바이오 에디터 */}
      <BioEditor 
        value={formData.bio}
        error={errors.bio}
        onChange={(bio) => handleChange('bio', bio)}
      />

      {/* 포트폴리오 링크 */}
      <PortfolioLinks 
        links={formData.portfolio_links}
        errors={errors}
        onChange={(links) => handleChange('portfolio_links', links)}
      />

      {/* 유튜브 동영상 */}
      <YoutubeVideos 
        videos={formData.youtube_videos}
        errors={errors}
        onChange={(videos) => handleChange('youtube_videos', videos)}
      />

      {/* 연락처 */}
      <div className="bg-gray-50 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">연락처</h3>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            이메일 (선택사항)
          </label>
          <input
            type="email"
            value={formData.contact}
            onChange={(e) => handleChange('contact', e.target.value)}
            className={`w-full px-3 py-2 border rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 ${
              errors.contact 
                ? 'border-red-300 focus:ring-red-500 focus:border-red-500' 
                : 'border-gray-300'
            }`}
            placeholder="artist@example.com"
          />
          {errors.contact && (
            <p className="mt-1 text-xs text-red-600">{errors.contact}</p>
          )}
          <p className="mt-1 text-xs text-gray-500">
            공개적으로 표시될 연락처입니다.
          </p>
        </div>
      </div>

      {/* 버튼 */}
      <div className="flex justify-between items-center pt-6 border-t border-gray-200">
        <div className="text-sm text-gray-500">
          {isDirty && '* 변경된 내용이 있습니다.'}
        </div>
        
        <div className="flex space-x-3">
          <button
            type="button"
            onClick={handleReset}
            disabled={!isDirty || loading}
            className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            취소
          </button>
          
          <button 
            type="submit" 
            disabled={!isDirty || loading}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <div className="flex items-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                저장 중...
              </div>
            ) : (
              '저장'
            )}
          </button>
        </div>
      </div>
    </form>
  )
}

export default ArtistEditForm