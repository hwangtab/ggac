/**
 * ProfilePhotoUploader - 프로필 사진 전용 업로더 컴포넌트
 * MediaManager를 확장하여 프로필 사진에 특화된 기능 제공
 */

'use client'

import React, { useState, useCallback, useRef, useEffect } from 'react'
import ReactCrop, { type Crop, type PixelCrop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import {
  FiCamera,
  FiUser,
  FiEdit3,
  FiTrash2,
  FiLoader,
  FiUpload,
  FiRotateCcw,
} from 'react-icons/fi'
import type {
  ProfilePhotoUploadRequest,
  ProfilePhotoUploadResponse,
  ProfilePhotoMetadata,
  ImageCropSettings,
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
  imageMetadata?: { width?: number; height?: number }
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
  className = '',
}) => {
  const [uploadState, setUploadState] = useState<UploadState>({
    isUploading: false,
    progress: 0,
  })
  const [isHovered, setIsHovered] = useState(false)
  const [showCropModal, setShowCropModal] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [crop, setCrop] = useState<Crop>()
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>()
  const [croppedImageUrl, setCroppedImageUrl] = useState<string>()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const cropDialogRef = useRef<HTMLDivElement>(null)
  const cropCloseButtonRef = useRef<HTMLButtonElement>(null)
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 크기별 스타일 설정
  const sizeClasses = {
    small: 'w-16 h-16',
    medium: 'w-24 h-24',
    large: 'w-32 h-32',
  }

  const iconSizes = {
    small: 'w-4 h-4',
    medium: 'w-5 h-5',
    large: 'w-6 h-6',
  }

  const clearUploadTimers = useCallback(() => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current)
      progressIntervalRef.current = null
    }

    if (resetTimeoutRef.current) {
      clearTimeout(resetTimeoutRef.current)
      resetTimeoutRef.current = null
    }
  }, [])

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

  // 파일 미리보기 생성 및 이미지 크기 추출
  const generatePreview = useCallback(
    (file: File): Promise<{ preview: string; width?: number; height?: number }> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = e => {
          const dataUrl = e.target?.result as string

          // 이미지 파일인 경우 크기 정보 추출
          if (file.type.startsWith('image/')) {
            const img = new Image()
            img.onload = () => {
              resolve({
                preview: dataUrl,
                width: img.width,
                height: img.height,
              })
            }
            img.onerror = () => {
              resolve({ preview: dataUrl })
            }
            img.src = dataUrl
          } else {
            resolve({ preview: dataUrl })
          }
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
    },
    []
  )

  // Canvas를 사용하여 크롭된 이미지 생성
  const getCroppedImg = useCallback(
    (
      image: HTMLImageElement,
      crop: PixelCrop,
      outputSize: { width: number; height: number } = { width: 400, height: 400 }
    ): Promise<File> => {
      return new Promise((resolve, reject) => {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')

        if (!ctx) {
          reject(new Error('Canvas context not available'))
          return
        }

        const scaleX = image.naturalWidth / image.width
        const scaleY = image.naturalHeight / image.height

        canvas.width = outputSize.width
        canvas.height = outputSize.height

        ctx.drawImage(
          image,
          crop.x * scaleX,
          crop.y * scaleY,
          crop.width * scaleX,
          crop.height * scaleY,
          0,
          0,
          outputSize.width,
          outputSize.height
        )

        canvas.toBlob(
          blob => {
            if (!blob) {
              reject(new Error('Canvas is empty'))
              return
            }
            const file = new File([blob], `cropped_${selectedFile?.name || 'image.jpg'}`, {
              type: 'image/jpeg',
              lastModified: Date.now(),
            })
            resolve(file)
          },
          'image/jpeg',
          0.95
        )
      })
    },
    [selectedFile]
  )

  // 크롭 미리보기 업데이트
  const updateCropPreview = useCallback(async (crop: PixelCrop) => {
    if (!imageRef.current || !previewCanvasRef.current || !crop.width || !crop.height) {
      return
    }

    const canvas = previewCanvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const image = imageRef.current
    const scaleX = image.naturalWidth / image.width
    const scaleY = image.naturalHeight / image.height

    const pixelRatio = window.devicePixelRatio
    canvas.width = crop.width * pixelRatio
    canvas.height = crop.height * pixelRatio

    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
    ctx.imageSmoothingQuality = 'high'

    ctx.drawImage(
      image,
      crop.x * scaleX,
      crop.y * scaleY,
      crop.width * scaleX,
      crop.height * scaleY,
      0,
      0,
      crop.width,
      crop.height
    )

    // 미리보기 URL 생성 (이전 URL은 useEffect cleanup이 revoke)
    canvas.toBlob(blob => {
      if (blob) {
        const url = URL.createObjectURL(blob)
        setCroppedImageUrl(url)
      }
    })
  }, [])

  // Blob URL 메모리 누수 방지: 교체 및 언마운트 시 모두 revoke
  const currentBlobUrl = useRef<string | null>(null)

  useEffect(() => {
    if (croppedImageUrl) {
      // 이전 blob URL revoke (교체 시)
      if (currentBlobUrl.current) {
        URL.revokeObjectURL(currentBlobUrl.current)
      }
      currentBlobUrl.current = croppedImageUrl
    }
    // 언마운트 시 최종 revoke
    return () => {
      if (currentBlobUrl.current) {
        URL.revokeObjectURL(currentBlobUrl.current)
        currentBlobUrl.current = null
      }
    }
  })

  // 크롭 모달 a11y: 열릴 때 focus 이동, focus trap, Escape 처리, 이전 focus 복원
  const [previousFocus, setPreviousFocus] = useState<HTMLElement | null>(null)

  // 모달 열릴 때 이전 focus 저장 + focus 이동
  useEffect(() => {
    if (showCropModal) {
      setPreviousFocus(document.activeElement as HTMLElement)
      cropCloseButtonRef.current?.focus()
    }
  }, [showCropModal])

  // 모달 닫힐 때 이전 focus 복원
  useEffect(() => {
    if (!showCropModal && previousFocus) {
      previousFocus.focus()
    }
  }, [showCropModal, previousFocus])

  // 키보드 이벤트: Escape + focus trap
  useEffect(() => {
    if (!showCropModal) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !uploadState.isUploading) {
        setShowCropModal(false)
        setSelectedFile(null)
        setCrop(undefined)
        setCompletedCrop(undefined)
        setCroppedImageUrl(undefined)
        setUploadState({ isUploading: false, progress: 0 })
        return
      }
      if (e.key === 'Tab' && cropDialogRef.current) {
        const focusable = cropDialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault()
            last?.focus()
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault()
            first?.focus()
          }
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showCropModal, uploadState.isUploading])

  // 이미지 로드 완료 시 기본 크롭 영역 설정
  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget
    const cropSize = Math.min(width, height) * 0.8 // 80% 크기로 설정
    const x = (width - cropSize) / 2
    const y = (height - cropSize) / 2

    const newCrop: Crop = {
      unit: 'px',
      x,
      y,
      width: cropSize,
      height: cropSize,
    }

    setCrop(newCrop)
  }, [])

  // 아티스트 프로필 사진 업로드 (Supabase Storage)
  const uploadProfilePhoto = useCallback(
    async (
      file: File,
      cropSettings?: ImageCropSettings,
      imageMetadata?: { width?: number; height?: number }
    ): Promise<ProfilePhotoUploadResponse> => {
      // 아티스트 프로필 업데이트를 위한 FormData 생성
      const formData = new FormData()
      formData.append('file', file)

      if (cropSettings) {
        formData.append('crop_settings', JSON.stringify(cropSettings))
      }

      // 메타데이터 추가 (클라이언트에서 추출한 이미지 크기 포함)
      const metadata: Partial<ProfilePhotoMetadata> = {
        original_filename: file.name,
        file_size: file.size,
        content_type: file.type,
        uploaded_at: new Date().toISOString(),
        crop_info: cropSettings,
        width: imageMetadata?.width,
        height: imageMetadata?.height,
      }
      formData.append('metadata', JSON.stringify(metadata))

      // 아티스트 프로필 사진 업로드 API 사용
      const response = await fetch('/api/mypage/artist/photo', {
        method: 'PUT',
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || '파일 업로드에 실패했습니다.')
      }

      return response.json()
    },
    []
  )

  // 업로드 시작
  const startUpload = useCallback(
    async (
      file: File,
      cropSettings?: ImageCropSettings,
      imageMetadata?: { width?: number; height?: number }
    ) => {
      setUploadState(prev => ({
        ...prev,
        isUploading: true,
        progress: 0,
        error: undefined,
      }))
      clearUploadTimers()

      try {
        // 진행률 시뮬레이션
        progressIntervalRef.current = setInterval(() => {
          setUploadState(prev => ({
            ...prev,
            progress: Math.min(prev.progress + 10, 90),
          }))
        }, 200)

        // 실제 업로드 (이미지 메타데이터 포함)
        const response = await uploadProfilePhoto(file, cropSettings, imageMetadata)

        if (progressIntervalRef.current) {
          clearInterval(progressIntervalRef.current)
          progressIntervalRef.current = null
        }

        setUploadState({
          isUploading: false,
          progress: 100,
        })

        // 성공 콜백 호출
        onUploadComplete?.(response)

        // 상태 초기화
        resetTimeoutRef.current = setTimeout(() => {
          setUploadState({
            isUploading: false,
            progress: 0,
          })
          setSelectedFile(null)
          setShowCropModal(false)
          resetTimeoutRef.current = null
        }, 1000)
      } catch (error) {
        if (progressIntervalRef.current) {
          clearInterval(progressIntervalRef.current)
          progressIntervalRef.current = null
        }

        console.error('Profile photo upload failed:', error)

        const errorMessage = error instanceof Error ? error.message : 'Upload failed'

        setUploadState(prev => ({
          ...prev,
          isUploading: false,
          error: errorMessage,
        }))

        onUploadError?.(errorMessage)
      }
    },
    [clearUploadTimers, uploadProfilePhoto, onUploadComplete, onUploadError]
  )

  useEffect(() => {
    return clearUploadTimers
  }, [clearUploadTimers])

  // 파일 선택 처리
  const handleFileSelect = useCallback(
    async (file: File) => {
      if (disabled) return

      // 파일 유효성 검사
      const validationError = validateFile(file)
      if (validationError) {
        onUploadError?.(validationError)
        return
      }

      try {
        // 미리보기 생성 및 이미지 크기 추출
        const { preview, width, height } = await generatePreview(file)

        setUploadState({
          isUploading: false,
          progress: 0,
          preview,
          imageMetadata: { width, height },
        })

        setSelectedFile(file)

        // 크롭 모달 표시 (이미지 파일인 경우)
        if (file.type.startsWith('image/')) {
          setShowCropModal(true)
        } else {
          // 크롭이 필요 없는 경우 바로 업로드
          await startUpload(file, undefined, { width, height })
        }
      } catch (error) {
        console.error('File preview generation failed:', error)
        onUploadError?.('파일 미리보기 생성에 실패했습니다.')
      }
    },
    [disabled, validateFile, generatePreview, onUploadError, startUpload]
  )

  // 파일 입력 클릭
  const handleFileInputClick = useCallback(() => {
    if (!disabled && fileInputRef.current) {
      fileInputRef.current.click()
    }
  }, [disabled])

  // 드래그 앤 드롭 처리
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()

      if (disabled) return

      const files = e.dataTransfer.files
      if (files.length > 0) {
        handleFileSelect(files[0])
      }
    },
    [disabled, handleFileSelect]
  )

  // 아티스트 프로필 사진 삭제
  const handlePhotoDelete = useCallback(async () => {
    if (!currentPhotoUrl || disabled) return

    if (!confirm('프로필 사진을 삭제하시겠습니까?')) return

    try {
      const response = await fetch('/api/mypage/artist/photo', {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Delete failed')
      }

      onPhotoDelete?.()
    } catch (error) {
      console.error('Artist photo delete failed:', error)
      onUploadError?.('프로필 사진 삭제에 실패했습니다.')
    }
  }, [currentPhotoUrl, disabled, onPhotoDelete, onUploadError])

  // 현재 표시할 이미지 URL
  const displayImageUrl = uploadState.preview || currentPhotoUrl

  return (
    <div className={`profile-photo-uploader flex flex-col items-center ${className}`}>
      <div
        className={`
          relative ${sizeClasses[size]} rounded-full overflow-hidden 
          border-2 border-gray-200 group cursor-pointer mx-auto
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          ${isHovered ? 'border-primary-400' : ''}
        `}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        onClick={handleFileInputClick}
      >
        {/* 파일 입력 */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={e => {
            if (e.target.files?.[0]) {
              handleFileSelect(e.target.files[0])
            }
          }}
          disabled={disabled}
        />

        {/* 프로필 사진 또는 기본 아바타 */}
        {displayImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
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
              <div className="text-xs">{displayImageUrl ? '변경' : '추가'}</div>
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
        <div className="mt-2 text-xs text-red-600 text-center">{uploadState.error}</div>
      )}

      {/* 파일 정보 */}
      {currentMetadata && (
        <div className="mt-2 text-xs text-gray-500 text-center">
          {currentMetadata.width && currentMetadata.height && (
            <div>
              {currentMetadata.width} × {currentMetadata.height}
            </div>
          )}
          {currentMetadata.file_size && (
            <div>
              {currentMetadata.file_size < 1024 * 1024
                ? `${(currentMetadata.file_size / 1024).toFixed(1)} KB`
                : `${(currentMetadata.file_size / 1024 / 1024).toFixed(1)} MB`}
            </div>
          )}
        </div>
      )}

      {/* 크롭 모달 */}
      {showCropModal && selectedFile && uploadState.preview && (
        <div
          ref={cropDialogRef}
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="crop-modal-title"
        >
          <div className="bg-white rounded-lg p-6 max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 id="crop-modal-title" className="text-lg font-medium">
                프로필 사진 크롭
              </h3>
              <button
                ref={cropCloseButtonRef}
                aria-label="크롭 모달 닫기"
                onClick={() => {
                  setShowCropModal(false)
                  setSelectedFile(null)
                  setCrop(undefined)
                  setCompletedCrop(undefined)
                  setCroppedImageUrl(undefined)
                  setUploadState({ isUploading: false, progress: 0 })
                }}
                className="text-gray-400 hover:text-gray-600"
                disabled={uploadState.isUploading}
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <p className="text-sm text-gray-600 mb-4">
              드래그하여 프로필 사진으로 사용할 영역을 선택해주세요. 정사각형으로 크롭됩니다.
            </p>

            <div className="grid md:grid-cols-2 gap-6">
              {/* 크롭 영역 */}
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-gray-900">원본 이미지</h4>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <ReactCrop
                    crop={crop}
                    onChange={c => setCrop(c)}
                    onComplete={c => {
                      setCompletedCrop(c)
                      if (c.width > 0 && c.height > 0) {
                        updateCropPreview(c)
                      }
                    }}
                    aspect={1} // 정사각형 비율 고정
                    minWidth={50}
                    minHeight={50}
                    maxWidth={600}
                    maxHeight={600}
                    keepSelection
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      ref={imageRef}
                      src={uploadState.preview}
                      alt="크롭할 이미지"
                      onLoad={onImageLoad}
                      className="max-w-full h-auto"
                      style={{ maxHeight: '400px' }}
                    />
                  </ReactCrop>
                </div>
              </div>

              {/* 미리보기 영역 */}
              <div className="space-y-3">
                <h4 className="text-sm font-medium text-gray-900">크롭 미리보기</h4>
                <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                  {croppedImageUrl ? (
                    <div className="text-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={croppedImageUrl}
                        alt="크롭 미리보기"
                        className="w-32 h-32 mx-auto rounded-full object-cover border-2 border-gray-300"
                      />
                      <p className="text-xs text-gray-500 mt-2">400 × 400px</p>
                    </div>
                  ) : (
                    <div className="w-32 h-32 mx-auto bg-gray-200 rounded-full flex items-center justify-center">
                      <FiUser className="w-12 h-12 text-gray-400" />
                    </div>
                  )}
                </div>

                {/* 크롭 정보 */}
                {completedCrop && (
                  <div className="text-xs text-gray-500 space-y-1">
                    <div>
                      크기: {Math.round(completedCrop.width)} × {Math.round(completedCrop.height)}
                    </div>
                    <div>
                      위치: ({Math.round(completedCrop.x)}, {Math.round(completedCrop.y)})
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 숨겨진 캔버스 (미리보기용) */}
            <canvas ref={previewCanvasRef} className="hidden" />

            {/* 하단 버튼들 */}
            <div className="flex flex-col sm:flex-row justify-between items-center mt-6 pt-4 border-t border-gray-200 gap-3">
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => {
                    if (imageRef.current) {
                      onImageLoad({
                        currentTarget: imageRef.current,
                      } as React.SyntheticEvent<HTMLImageElement>)
                    }
                  }}
                  className="flex items-center px-3 py-2 text-sm text-gray-600 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
                  disabled={uploadState.isUploading}
                >
                  <FiRotateCcw className="w-4 h-4 mr-1" />
                  초기화
                </button>
              </div>

              <div className="flex space-x-3">
                <button
                  onClick={() => {
                    setShowCropModal(false)
                    setSelectedFile(null)
                    setCrop(undefined)
                    setCompletedCrop(undefined)
                    setCroppedImageUrl(undefined)
                    setUploadState({ isUploading: false, progress: 0 })
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
                  disabled={uploadState.isUploading}
                >
                  취소
                </button>
                <button
                  onClick={async () => {
                    if (selectedFile && completedCrop && imageRef.current) {
                      try {
                        // 크롭된 이미지 생성
                        const croppedFile = await getCroppedImg(imageRef.current, completedCrop)

                        // 크롭 설정 생성
                        const cropSettings: ImageCropSettings = {
                          x: completedCrop.x,
                          y: completedCrop.y,
                          width: completedCrop.width,
                          height: completedCrop.height,
                          output_size: { width: 400, height: 400 },
                        }

                        // 업로드 시작
                        startUpload(croppedFile, cropSettings, { width: 400, height: 400 })
                        setShowCropModal(false)
                      } catch (error) {
                        console.error('크롭 처리 오류:', error)
                        onUploadError?.('이미지 크롭 처리 중 오류가 발생했습니다.')
                      }
                    }
                  }}
                  className="px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 transition-colors disabled:opacity-50"
                  disabled={uploadState.isUploading || !completedCrop || !croppedImageUrl}
                >
                  {uploadState.isUploading ? (
                    <span className="flex items-center">
                      <FiLoader className="w-4 h-4 mr-2 animate-spin" />
                      업로드 중...
                    </span>
                  ) : (
                    '크롭 후 업로드'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ProfilePhotoUploader
