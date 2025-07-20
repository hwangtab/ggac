/**
 * ProfilePhotoUploader - 프로필 사진 전용 업로더 컴포넌트
 * MediaManager를 확장하여 프로필 사진에 특화된 기능 제공
 */

'use client'

import React, { useState, useCallback, useRef } from 'react'
import { FiCamera, FiUser, FiEdit3, FiTrash2, FiLoader, FiUpload } from 'react-icons/fi'
import type { 
  ProfilePhotoUploadRequest,
  ProfilePhotoUploadResponse,
  ProfilePhotoMetadata,
  ImageCropSettings
} from '@/types'

interface ProfilePhotoUploaderProps {
  /** 현재 프로필 사진 URL */
  currentPhotoUrl?: string | null
  /** 현재 프로필 사진 메타데이터 */
  currentMetadata?: ProfilePhotoMetadata
  /** 사용자 표시명 (대체 텍스트용) */
  userDisplayName?: string
  /** 업로드 완료 콜백 */
  onUploadComplete?: (response: ProfilePhotoUploadResponse) => void
  /** 업로드 에러 콜백 */
  onUploadError?: (error: string) => void
  /** 사진 삭제 콜백 */
  onPhotoDelete?: () => void
  /** 크기 ('small' | 'medium' | 'large') */
  size?: 'small' | 'medium' | 'large'
  /** 비활성화 여부 */
  disabled?: boolean
  /** 추가 CSS 클래스 */
  className?: string
}

interface UploadState {
  isUploading: boolean
  progress: number
  preview?: string
  error?: string
}

const ProfilePhotoUploader: React.FC<ProfilePhotoUploaderProps> = ({
  currentPhotoUrl,
  currentMetadata,
  userDisplayName = 'User',
  onUploadComplete,
  onUploadError,
  onPhotoDelete,
  size = 'medium',
  disabled = false,
  className = ''
}) => {
  const [uploadState, setUploadState] = useState<UploadState>({
    isUploading: false,
    progress: 0
  })
  const [isHovered, setIsHovered] = useState(false)
  const [showCropModal, setShowCropModal] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 크기별 스타일 설정
  const sizeClasses = {
    small: 'w-16 h-16',
    medium: 'w-24 h-24',
    large: 'w-32 h-32'
  }

  const iconSizes = {
    small: 'w-4 h-4',
    medium: 'w-5 h-5',
    large: 'w-6 h-6'
  }

  // 파일 유효성 검사
  const validateFile = useCallback((file: File): string | null => {
    const maxSize = 2 * 1024 * 1024 // 2MB
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

    if (!allowedTypes.includes(file.type)) {
      return '지원하지 않는 파일 형식입니다. JPEG, PNG, WebP, GIF만 가능합니다.'
    }

    if (file.size > maxSize) {
      return '파일 크기가 너무 큽니다. 최대 2MB까지 가능합니다.'
    }

    return null
  }, [])

  // 파일 미리보기 생성
  const generatePreview = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => resolve(e.target?.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }, [])

  // 프로필 사진 업로드
  const uploadProfilePhoto = useCallback(async (
    file: File, 
    cropSettings?: ImageCropSettings
  ): Promise<ProfilePhotoUploadResponse> => {
    const formData = new FormData()
    formData.append('file', file)
    
    if (cropSettings) {
      formData.append('crop_settings', JSON.stringify(cropSettings))
    }

    // 메타데이터 추가
    const metadata: Partial<ProfilePhotoMetadata> = {
      original_filename: file.name,
      file_size: file.size,
      content_type: file.type,
      uploaded_at: new Date().toISOString(),
      crop_info: cropSettings
    }
    formData.append('metadata', JSON.stringify(metadata))

    const response = await fetch('/api/mypage/profile/photo', {
      method: 'PUT',
      body: formData
    })

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || 'Upload failed')
    }

    return response.json()
  }, [])

  // 파일 선택 처리
  const handleFileSelect = useCallback(async (file: File) => {
    if (disabled) return

    // 파일 유효성 검사
    const validationError = validateFile(file)
    if (validationError) {
      onUploadError?.(validationError)
      return
    }

    try {
      // 미리보기 생성
      const preview = await generatePreview(file)
      
      setUploadState({
        isUploading: false,
        progress: 0,
        preview
      })

      setSelectedFile(file)
      
      // 크롭 모달 표시 (이미지 파일인 경우)
      if (file.type.startsWith('image/')) {
        setShowCropModal(true)
      } else {
        // 크롭이 필요 없는 경우 바로 업로드
        await startUpload(file)
      }
    } catch (error) {
      console.error('File preview generation failed:', error)
      onUploadError?.('파일 미리보기 생성에 실패했습니다.')
    }
  }, [disabled, validateFile, generatePreview, onUploadError])

  // 업로드 시작
  const startUpload = useCallback(async (
    file: File, 
    cropSettings?: ImageCropSettings
  ) => {
    setUploadState(prev => ({
      ...prev,
      isUploading: true,
      progress: 0,
      error: undefined
    }))

    try {
      // 진행률 시뮬레이션
      const progressInterval = setInterval(() => {
        setUploadState(prev => ({
          ...prev,
          progress: Math.min(prev.progress + 10, 90)
        }))
      }, 200)

      // 실제 업로드
      const response = await uploadProfilePhoto(file, cropSettings)

      clearInterval(progressInterval)

      setUploadState({
        isUploading: false,
        progress: 100
      })

      // 성공 콜백 호출
      onUploadComplete?.(response)

      // 상태 초기화
      setTimeout(() => {
        setUploadState({
          isUploading: false,
          progress: 0
        })
        setSelectedFile(null)
        setShowCropModal(false)
      }, 1000)

    } catch (error) {
      console.error('Profile photo upload failed:', error)
      
      const errorMessage = error instanceof Error ? error.message : 'Upload failed'
      
      setUploadState(prev => ({
        ...prev,
        isUploading: false,
        error: errorMessage
      }))

      onUploadError?.(errorMessage)
    }
  }, [uploadProfilePhoto, onUploadComplete, onUploadError])

  // 파일 입력 클릭
  const handleFileInputClick = useCallback(() => {
    if (!disabled && fileInputRef.current) {
      fileInputRef.current.click()
    }
  }, [disabled])

  // 드래그 앤 드롭 처리
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    
    if (disabled) return

    const files = e.dataTransfer.files
    if (files.length > 0) {
      handleFileSelect(files[0])
    }
  }, [disabled, handleFileSelect])

  // 프로필 사진 삭제
  const handlePhotoDelete = useCallback(async () => {
    if (!currentPhotoUrl || disabled) return

    if (!confirm('프로필 사진을 삭제하시겠습니까?')) return

    try {
      const response = await fetch('/api/mypage/profile/photo', {
        method: 'DELETE'
      })

      if (!response.ok) {
        throw new Error('Delete failed')
      }

      onPhotoDelete?.()
    } catch (error) {
      console.error('Profile photo delete failed:', error)
      onUploadError?.('프로필 사진 삭제에 실패했습니다.')
    }
  }, [currentPhotoUrl, disabled, onPhotoDelete, onUploadError])

  // 현재 표시할 이미지 URL
  const displayImageUrl = uploadState.preview || currentPhotoUrl

  return (
    <div className={`profile-photo-uploader ${className}`}>
      <div
        className={`
          relative ${sizeClasses[size]} rounded-full overflow-hidden 
          border-2 border-gray-200 group cursor-pointer
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          ${isHovered ? 'border-primary-400' : ''}
        `}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={handleFileInputClick}
      >
        {/* 파일 입력 */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={(e) => {
            if (e.target.files?.[0]) {
              handleFileSelect(e.target.files[0])
            }
          }}
          disabled={disabled}
        />

        {/* 프로필 사진 또는 기본 아바타 */}
        {displayImageUrl ? (
          <img
            src={displayImageUrl}
            alt={`${userDisplayName}의 프로필 사진`}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gray-100 flex items-center justify-center">
            <FiUser className={`${iconSizes[size]} text-gray-400`} />
          </div>
        )}

        {/* 업로드 진행률 */}
        {uploadState.isUploading && (
          <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
            <div className="text-center text-white">
              <FiLoader className={`${iconSizes[size]} animate-spin mx-auto mb-1`} />
              <div className="text-xs">{uploadState.progress}%</div>
            </div>
          </div>
        )}

        {/* 호버 오버레이 */}
        {!uploadState.isUploading && !disabled && (
          <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50 transition-all duration-200 flex items-center justify-center">
            <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-white text-center">
              {displayImageUrl ? (
                <FiEdit3 className={`${iconSizes[size]} mx-auto mb-1`} />
              ) : (
                <FiCamera className={`${iconSizes[size]} mx-auto mb-1`} />
              )}
              <div className="text-xs">
                {displayImageUrl ? '변경' : '추가'}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 액션 버튼들 */}
      {currentPhotoUrl && !disabled && (
        <div className="mt-2 flex justify-center space-x-2">
          <button
            onClick={handleFileInputClick}
            className="text-sm text-primary-600 hover:text-primary-700"
            disabled={uploadState.isUploading}
          >
            변경
          </button>
          <span className="text-gray-300">|</span>
          <button
            onClick={handlePhotoDelete}
            className="text-sm text-red-600 hover:text-red-700"
            disabled={uploadState.isUploading}
          >
            삭제
          </button>
        </div>
      )}

      {/* 에러 메시지 */}
      {uploadState.error && (
        <div className="mt-2 text-xs text-red-600 text-center">
          {uploadState.error}
        </div>
      )}

      {/* 파일 정보 */}
      {currentMetadata && (
        <div className="mt-2 text-xs text-gray-500 text-center">
          {currentMetadata.width && currentMetadata.height && (
            <div>{currentMetadata.width} × {currentMetadata.height}</div>
          )}
          {currentMetadata.file_size && (
            <div>
              {currentMetadata.file_size < 1024 * 1024 
                ? `${(currentMetadata.file_size / 1024).toFixed(1)} KB`
                : `${(currentMetadata.file_size / 1024 / 1024).toFixed(1)} MB`
              }
            </div>
          )}
        </div>
      )}

      {/* TODO: 크롭 모달 */}
      {showCropModal && selectedFile && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4">
            <h3 className="text-lg font-medium mb-4">이미지 크롭</h3>
            <p className="text-sm text-gray-600 mb-4">
              프로필 사진으로 사용할 영역을 선택해주세요.
            </p>
            
            {/* TODO: 실제 크롭 컴포넌트 구현 */}
            <div className="border-2 border-dashed border-gray-300 rounded p-8 text-center mb-4">
              <p className="text-gray-500">크롭 기능이 곧 추가됩니다.</p>
              {uploadState.preview && (
                <img 
                  src={uploadState.preview} 
                  alt="Preview" 
                  className="max-w-full max-h-40 mx-auto mt-2"
                />
              )}
            </div>

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowCropModal(false)
                  setSelectedFile(null)
                  setUploadState({
                    isUploading: false,
                    progress: 0
                  })
                }}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded hover:bg-gray-200"
                disabled={uploadState.isUploading}
              >
                취소
              </button>
              <button
                onClick={() => {
                  if (selectedFile) {
                    startUpload(selectedFile)
                    setShowCropModal(false)
                  }
                }}
                className="px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700"
                disabled={uploadState.isUploading}
              >
                {uploadState.isUploading ? '업로드 중...' : '업로드'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ProfilePhotoUploader