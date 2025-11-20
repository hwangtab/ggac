/**
 * MediaManager - 재사용 가능한 미디어 관리 컴포넌트
 * 프로필 사진, 게시글 첨부파일 등 다양한 용도로 사용 가능
 */

'use client'

import React, { useState, useCallback, useRef } from 'react'
import { FiUpload, FiX, FiImage, FiLoader, FiCheck, FiAlertCircle, FiEdit3 } from 'react-icons/fi'
import ImageCropModal from './ImageCropModal'
import type {
  MediaFile,
  MediaManagerConfig,
  ImageCropSettings,
  ProfilePhotoMetadata,
} from '@/types'

interface MediaManagerProps {
  /** 컴포넌트 고유 ID */
  id: string
  /** 설정 객체 */
  config: MediaManagerConfig
  /** 기존 미디어 파일들 */
  existingFiles?: MediaFile[]
  /** 업로드 완료 콜백 */
  onUploadComplete?: (files: MediaFile[]) => void
  /** 업로드 에러 콜백 */
  onUploadError?: (error: string) => void
  /** 파일 삭제 콜백 */
  onFileDelete?: (fileId: string) => void
  /** 모드 ('single' | 'multiple') */
  mode?: 'single' | 'multiple'
  /** 업로드할 Storage bucket */
  bucket?: string
  /** 추가 CSS 클래스 */
  className?: string
  /** 비활성화 여부 */
  disabled?: boolean
  /** 크롭 모드 활성화 여부 */
  enableCrop?: boolean
  /** 크롭 설정 */
  cropSettings?: ImageCropSettings
}

interface UploadingFile {
  id: string
  file: File
  progress: number
  error?: string
  preview?: string
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'error'
  cropSettings?: ImageCropSettings
}

const MediaManager: React.FC<MediaManagerProps> = ({
  id,
  config,
  existingFiles = [],
  onUploadComplete,
  onUploadError,
  onFileDelete,
  mode = 'multiple',
  bucket = 'attachments',
  className = '',
  disabled = false,
  enableCrop = false,
  cropSettings,
}) => {
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([])
  const [completedFiles, setCompletedFiles] = useState<MediaFile[]>(existingFiles)
  const [isDragOver, setIsDragOver] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [cropModal, setCropModal] = useState<{
    isOpen: boolean
    file: MediaFile | null
    imageUrl: string
  }>({
    isOpen: false,
    file: null,
    imageUrl: '',
  })
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 크롭 처리
  const handleCrop = useCallback(
    async (croppedBlob: Blob, cropArea: any) => {
      if (!cropModal.file) return

      try {
        // 크롭된 이미지를 새 파일로 생성
        const croppedFile = new File([croppedBlob], `cropped_${cropModal.file.name}`, {
          type: croppedBlob.type,
        })

        // 기존 파일 삭제
        if (onFileDelete) {
          await onFileDelete(cropModal.file.id)
        }

        // 새 파일 업로드
        const uploadingFile: UploadingFile = {
          file: croppedFile,
          progress: 0,
          id: `upload-${Date.now()}-${Math.random()}`,
          status: 'uploading',
        }
        await uploadFile(uploadingFile)

        // 모달 닫기
        setCropModal({ isOpen: false, file: null, imageUrl: '' })
      } catch (error) {
        console.error('크롭 처리 오류:', error)
        if (onUploadError) {
          onUploadError('이미지 크롭 처리 중 오류가 발생했습니다.')
        }
      }
    },
    [cropModal.file, onFileDelete, onUploadError]
  )

  // 파일 타입 확인
  const isValidFileType = useCallback(
    (file: File): boolean => {
      return config.allowed_types.includes(file.type)
    },
    [config.allowed_types]
  )

  // 파일 크기 확인
  const isValidFileSize = useCallback(
    (file: File): boolean => {
      return file.size <= config.max_file_size
    },
    [config.max_file_size]
  )

  // 이미지 파일 여부 확인
  const isImageFile = useCallback((file: File): boolean => {
    return file.type.startsWith('image/')
  }, [])

  // 파일 미리보기 생성
  const generatePreview = useCallback(
    (file: File): Promise<string> => {
      return new Promise((resolve, reject) => {
        if (!isImageFile(file)) {
          resolve('')
          return
        }

        const reader = new FileReader()
        reader.onload = e => {
          resolve((e.target?.result as string) || '')
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
    },
    [isImageFile]
  )

  // 파일 업로드 처리
  const uploadFile = useCallback(
    async (uploadingFile: UploadingFile): Promise<MediaFile> => {
      const { file, cropSettings } = uploadingFile

      // FormData 생성
      const formData = new FormData()
      formData.append('file', file)
      formData.append('bucket', bucket)

      if (cropSettings) {
        formData.append('crop_settings', JSON.stringify(cropSettings))
      }

      // 메타데이터 추가
      const metadata: Partial<ProfilePhotoMetadata> = {
        original_filename: file.name,
        file_size: file.size,
        content_type: file.type,
        uploaded_at: new Date().toISOString(),
      }
      formData.append('metadata', JSON.stringify(metadata))

      // 업로드 API 호출
      const response = await fetch(`/api/media/upload`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Upload failed')
      }

      const result = await response.json()
      const uploadedFile: MediaFile | undefined = result.file

      return {
        id: uploadedFile?.id || result.id,
        name: uploadedFile?.name || result.name || file.name,
        size: uploadedFile?.size || file.size,
        type: uploadedFile?.type || file.type,
        path: uploadedFile?.path || result.path,
        public_url: uploadedFile?.public_url || result.public_url,
        variants: uploadedFile?.variants || result.variants,
        variant_urls: uploadedFile?.variant_urls || result.variant_urls,
        uploaded_at: uploadedFile?.uploaded_at || new Date().toISOString(),
        metadata: uploadedFile?.metadata || result.metadata || {},
      }
    },
    [bucket]
  )

  // 업로드 시작
  const startUpload = useCallback(
    async (files: UploadingFile[]) => {
      setIsUploading(true)
      const uploadedThisBatch: MediaFile[] = []

      for (const file of files) {
        try {
          // 상태 업데이트: 업로딩 중
          setUploadingFiles(prev =>
            prev.map(f => (f.id === file.id ? { ...f, status: 'uploading', progress: 0 } : f))
          )

          // 진행률 시뮬레이션
          const progressInterval = setInterval(() => {
            setUploadingFiles(prev =>
              prev.map(f =>
                f.id === file.id && f.status === 'uploading'
                  ? { ...f, progress: Math.min(f.progress + 10, 90) }
                  : f
              )
            )
          }, 200)

          // 실제 업로드
          const uploadedFile = await uploadFile(file)

          // 방금 업로드된 파일을 로컬 배열에 추가
          uploadedThisBatch.push(uploadedFile)
          clearInterval(progressInterval)

          // 상태 업데이트: 완료
          setUploadingFiles(prev =>
            prev.map(f => (f.id === file.id ? { ...f, status: 'completed', progress: 100 } : f))
          )

          // 완료된 파일 목록에 추가
          setCompletedFiles(prev => [...prev, uploadedFile])

          // 잠시 후 업로딩 목록에서 제거
          setTimeout(() => {
            setUploadingFiles(prev => prev.filter(f => f.id !== file.id))
          }, 1000)
        } catch (error) {
          console.error('Upload failed:', error)

          setUploadingFiles(prev =>
            prev.map(f =>
              f.id === file.id
                ? {
                    ...f,
                    status: 'error',
                    error: error instanceof Error ? error.message : 'Upload failed',
                  }
                : f
            )
          )

          onUploadError?.(error instanceof Error ? error.message : 'Upload failed')
        }
      }

      setIsUploading(false)

      // 업로드 완료 콜백 호출
      // 클로저 스냅샷 문제 해결: completedFiles(의존성)와 uploadedThisBatch(로컬)를 합쳐서 전달
      if (uploadedThisBatch.length > 0 && onUploadComplete) {
        onUploadComplete([...completedFiles, ...uploadedThisBatch])
      }
    },
    [uploadFile, onUploadError, onUploadComplete, completedFiles]
  )

  // 파일 선택 처리
  const handleFileSelect = useCallback(
    async (files: FileList | File[]) => {
      if (disabled || isUploading) return

      const fileArray = Array.from(files)

      // 파일 개수 제한 확인
      if (mode === 'single' && fileArray.length > 1) {
        onUploadError?.('한 번에 하나의 파일만 업로드할 수 있습니다.')
        return
      }

      if (completedFiles.length + uploadingFiles.length + fileArray.length > config.max_files) {
        onUploadError?.(`최대 ${config.max_files}개의 파일만 업로드할 수 있습니다.`)
        return
      }

      // 파일 유효성 검사 및 미리보기 생성
      const validFiles: UploadingFile[] = []

      for (const file of fileArray) {
        if (!isValidFileType(file)) {
          onUploadError?.(`지원하지 않는 파일 형식입니다: ${file.type}`)
          continue
        }

        if (!isValidFileSize(file)) {
          onUploadError?.(`파일 크기가 너무 큽니다: ${(file.size / 1024 / 1024).toFixed(1)}MB`)
          continue
        }

        try {
          const preview = await generatePreview(file)

          validFiles.push({
            id: `uploading-${Date.now()}-${Math.random()}`,
            file,
            progress: 0,
            status: 'pending',
            preview,
          })
        } catch (error) {
          console.error('Preview generation failed:', error)
          validFiles.push({
            id: `uploading-${Date.now()}-${Math.random()}`,
            file,
            progress: 0,
            status: 'pending',
          })
        }
      }

      if (validFiles.length === 0) return

      // 단일 모드에서는 기존 파일 제거
      if (mode === 'single') {
        setUploadingFiles([])
        setCompletedFiles([])
      }

      setUploadingFiles(prev => [...prev, ...validFiles])

      // 업로드 시작
      startUpload(validFiles)
    },
    [
      disabled,
      isUploading,
      mode,
      completedFiles.length,
      uploadingFiles.length,
      config.max_files,
      isValidFileType,
      isValidFileSize,
      generatePreview,
      onUploadError,
      startUpload,
    ]
  )

  // 드래그 앤 드롭 처리
  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      if (!disabled) {
        setIsDragOver(true)
      }
    },
    [disabled]
  )

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)

      if (disabled) return

      const files = e.dataTransfer.files
      if (files.length > 0) {
        handleFileSelect(files)
      }
    },
    [disabled, handleFileSelect]
  )

  // 파일 입력 클릭
  const handleFileInputClick = useCallback(() => {
    if (!disabled && fileInputRef.current) {
      fileInputRef.current.click()
    }
  }, [disabled])

  // 파일 삭제
  const handleFileDelete = useCallback(
    (fileId: string) => {
      setCompletedFiles(prev => prev.filter(f => f.id !== fileId))
      onFileDelete?.(fileId)
    },
    [onFileDelete]
  )

  // 업로딩 파일 제거
  const handleUploadingFileRemove = useCallback((fileId: string) => {
    setUploadingFiles(prev => prev.filter(f => f.id !== fileId))
  }, [])

  // 파일 크기 포맷팅
  const formatFileSize = useCallback((bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }, [])

  return (
    <div className={`media-manager ${className}`}>
      {/* 업로드 영역 */}
      <div
        className={`
          border-2 border-dashed rounded-lg p-6 text-center transition-colors
          ${isDragOver ? 'border-primary-500 bg-primary-50' : 'border-gray-300'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-primary-400'}
        `}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleFileInputClick}
      >
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          multiple={mode === 'multiple'}
          accept={config.allowed_types.join(',')}
          onChange={e => {
            if (e.target.files) {
              handleFileSelect(e.target.files)
            }
          }}
          disabled={disabled}
        />

        <div className="flex flex-col items-center">
          <FiUpload className="w-8 h-8 text-gray-400 mb-2" />
          <p className="text-sm text-gray-600 mb-1">
            {mode === 'single'
              ? '파일을 클릭하거나 드래그하여 업로드'
              : '파일들을 클릭하거나 드래그하여 업로드'}
          </p>
          <p className="text-xs text-gray-500">
            최대 {formatFileSize(config.max_file_size)}, {config.allowed_types.join(', ')}
          </p>
        </div>
      </div>

      {/* 업로딩 중인 파일들 */}
      {uploadingFiles.length > 0 && (
        <div className="mt-4 space-y-2">
          <h4 className="text-sm font-medium text-gray-700">업로딩 중</h4>
          {uploadingFiles.map(file => (
            <div key={file.id} className="flex items-center space-x-3 p-3 bg-gray-50 rounded-lg">
              {/* 미리보기 또는 아이콘 */}
              <div className="flex-shrink-0">
                {file.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={file.preview}
                    alt={file.file.name}
                    className="w-10 h-10 object-cover rounded"
                  />
                ) : (
                  <FiImage className="w-10 h-10 text-gray-400" />
                )}
              </div>

              {/* 파일 정보 */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{file.file.name}</p>
                <p className="text-xs text-gray-500">{formatFileSize(file.file.size)}</p>

                {/* 진행률 바 */}
                {file.status === 'uploading' && (
                  <div className="mt-1 w-full bg-gray-200 rounded-full h-1.5">
                    <div
                      className="bg-primary-600 h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${file.progress}%` }}
                    />
                  </div>
                )}

                {/* 에러 메시지 */}
                {file.error && <p className="text-xs text-red-600 mt-1">{file.error}</p>}
              </div>

              {/* 상태 아이콘 */}
              <div className="flex-shrink-0">
                {file.status === 'uploading' && (
                  <FiLoader className="w-4 h-4 text-primary-600 animate-spin" />
                )}
                {file.status === 'completed' && <FiCheck className="w-4 h-4 text-green-600" />}
                {file.status === 'error' && <FiAlertCircle className="w-4 h-4 text-red-600" />}
                {(file.status === 'pending' || file.status === 'error') && (
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      handleUploadingFileRemove(file.id)
                    }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <FiX className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 완료된 파일들 */}
      {completedFiles.length > 0 && (
        <div className="mt-4 space-y-2">
          <h4 className="text-sm font-medium text-gray-700">업로드된 파일</h4>
          {completedFiles.map(file => (
            <div
              key={file.id}
              className="flex items-center space-x-3 p-3 bg-green-50 border border-green-200 rounded-lg"
            >
              {/* 미리보기 또는 아이콘 */}
              <div className="flex-shrink-0">
                {file.type.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={file.public_url}
                    alt={file.name}
                    className="w-10 h-10 object-cover rounded"
                  />
                ) : (
                  <FiImage className="w-10 h-10 text-gray-400" />
                )}
              </div>

              {/* 파일 정보 */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                <p className="text-xs text-gray-500">{formatFileSize(file.size)} • 업로드 완료</p>
              </div>

              {/* 액션 버튼들 */}
              <div className="flex-shrink-0 flex items-center space-x-1">
                {enableCrop && file.type.startsWith('image/') && (
                  <button
                    onClick={e => {
                      e.stopPropagation()
                      // 크롭 모달 열기
                      setCropModal({
                        isOpen: true,
                        file,
                        imageUrl: file.public_url,
                      })
                    }}
                    className="text-gray-400 hover:text-gray-600"
                    title="이미지 편집"
                  >
                    <FiEdit3 className="w-4 h-4" />
                  </button>
                )}

                <button
                  onClick={e => {
                    e.stopPropagation()
                    handleFileDelete(file.id)
                  }}
                  className="text-gray-400 hover:text-red-600"
                  title="파일 삭제"
                >
                  <FiX className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 설정 정보 표시 (개발 모드) */}
      {process.env.NODE_ENV === 'development' && (
        <div className="mt-4 p-3 bg-gray-100 rounded text-xs text-gray-600">
          <p>Config: {JSON.stringify(config, null, 2)}</p>
        </div>
      )}

      {/* 이미지 크롭 모달 */}
      {enableCrop && (
        <ImageCropModal
          isOpen={cropModal.isOpen}
          imageUrl={cropModal.imageUrl}
          imageName={cropModal.file?.name || ''}
          onClose={() => setCropModal({ isOpen: false, file: null, imageUrl: '' })}
          onCrop={handleCrop}
          aspectRatio={cropSettings?.aspectRatio}
        />
      )}
    </div>
  )
}

export default MediaManager
