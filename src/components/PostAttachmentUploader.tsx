/**
 * 게시글 첨부파일 업로더 컴포넌트
 * 이미지, 문서 등 다양한 파일 형식을 지원하는 드래그앤드롭 업로더
 */

'use client'

import React, { useState, useCallback, useRef } from 'react'
import { FiUpload, FiX, FiImage, FiFile, FiVideo, FiMusic, FiCheck, FiAlertCircle } from 'react-icons/fi'
import type { PostAttachment, PostAttachmentUpload } from '@/types'

interface PostAttachmentUploaderProps {
  postId: string
  maxFiles?: number
  maxTotalSize?: number
  onUploadComplete?: (attachments: PostAttachment[]) => void
  onUploadError?: (error: string) => void
  className?: string
}

interface UploadingFile {
  id: string
  file: File
  progress: number
  error?: string
  altText?: string
  isPrimary?: boolean
}

const PostAttachmentUploader: React.FC<PostAttachmentUploaderProps> = ({
  postId,
  maxFiles = 10,
  maxTotalSize = 10 * 1024 * 1024, // 10MB
  onUploadComplete,
  onUploadError,
  className = ''
}) => {
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 허용된 파일 타입
  const ALLOWED_TYPES = [
    'image/jpeg',
    'image/png', 
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'video/mp4',
    'video/webm',
    'audio/mpeg',
    'audio/wav'
  ]

  const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB per file

  // 파일 선택 핸들러
  const handleFileSelect = useCallback((files: FileList) => {
    const fileArray = Array.from(files)
    const validFiles: File[] = []
    const errors: string[] = []

    // 파일 개수 체크
    if (uploadingFiles.length + fileArray.length > maxFiles) {
      errors.push(`최대 ${maxFiles}개의 파일만 업로드할 수 있습니다.`)
    }

    // 파일 검증
    fileArray.forEach(file => {
      if (!ALLOWED_TYPES.includes(file.type)) {
        errors.push(`${file.name}: 지원하지 않는 파일 형식입니다.`)
        return
      }

      if (file.size > MAX_FILE_SIZE) {
        errors.push(`${file.name}: 파일 크기가 너무 큽니다. (최대 50MB)`)
        return
      }

      validFiles.push(file)
    })

    // 총 파일 크기 체크
    const totalSize = [...uploadingFiles.map(f => f.file.size), ...validFiles.map(f => f.size)]
      .reduce((sum, size) => sum + size, 0)

    if (totalSize > maxTotalSize) {
      errors.push(`총 파일 크기가 제한을 초과했습니다. (최대 ${maxTotalSize / 1024 / 1024}MB)`)
    }

    // 오류가 있으면 표시하고 중단
    if (errors.length > 0) {
      onUploadError?.(errors.join('\\n'))
      return
    }

    // 업로드 대기열에 추가
    const newUploadingFiles: UploadingFile[] = validFiles.map(file => ({
      id: `${Date.now()}-${Math.random().toString(36).substring(2)}`,
      file,
      progress: 0
    }))

    setUploadingFiles(prev => [...prev, ...newUploadingFiles])
  }, [uploadingFiles, maxFiles, maxTotalSize, onUploadError])

  // 드래그 앤 드롭 핸들러
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    
    const files = e.dataTransfer.files
    if (files.length > 0) {
      handleFileSelect(files)
    }
  }, [handleFileSelect])

  // 파일 입력 클릭
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      handleFileSelect(files)
    }
    // 입력 값 초기화
    e.target.value = ''
  }, [handleFileSelect])

  // 개별 파일 삭제
  const removeFile = useCallback((fileId: string) => {
    setUploadingFiles(prev => prev.filter(f => f.id !== fileId))
  }, [])

  // 파일 메타데이터 업데이트
  const updateFileMetadata = useCallback((fileId: string, updates: Partial<Pick<UploadingFile, 'altText' | 'isPrimary'>>) => {
    setUploadingFiles(prev => prev.map(f => 
      f.id === fileId ? { ...f, ...updates } : f
    ))
  }, [])

  // 업로드 실행
  const uploadFiles = useCallback(async () => {
    if (uploadingFiles.length === 0) return

    setIsUploading(true)
    const completedAttachments: PostAttachment[] = []

    try {
      for (const uploadingFile of uploadingFiles) {
        try {
          // FormData 생성
          const formData = new FormData()
          formData.append('file', uploadingFile.file)
          if (uploadingFile.altText) {
            formData.append('alt_text', uploadingFile.altText)
          }
          if (uploadingFile.isPrimary) {
            formData.append('is_primary', 'true')
          }

          // 진행률 업데이트
          setUploadingFiles(prev => prev.map(f => 
            f.id === uploadingFile.id ? { ...f, progress: 50 } : f
          ))

          // API 호출
          const response = await fetch(`/api/posts/${postId}/attachments`, {
            method: 'POST',
            body: formData
          })

          const result = await response.json()

          if (!response.ok) {
            throw new Error(result.error || '업로드에 실패했습니다.')
          }

          // 완료된 첨부파일 추가
          completedAttachments.push(result.attachment)

          // 진행률 완료
          setUploadingFiles(prev => prev.map(f => 
            f.id === uploadingFile.id ? { ...f, progress: 100 } : f
          ))

        } catch (error) {
          console.error(`파일 업로드 오류 (${uploadingFile.file.name}):`, error)
          
          // 오류 표시
          setUploadingFiles(prev => prev.map(f => 
            f.id === uploadingFile.id 
              ? { ...f, error: error instanceof Error ? error.message : '업로드 실패' } 
              : f
          ))
        }
      }

      // 성공한 파일들만 콜백 호출
      if (completedAttachments.length > 0) {
        onUploadComplete?.(completedAttachments)
      }

      // 업로드 완료된 파일들 제거 (오류가 없는 것만)
      setTimeout(() => {
        setUploadingFiles(prev => prev.filter(f => f.error || f.progress < 100))
      }, 2000)

    } catch (error) {
      console.error('파일 업로드 전체 오류:', error)
      onUploadError?.(error instanceof Error ? error.message : '업로드에 실패했습니다.')
    } finally {
      setIsUploading(false)
    }
  }, [uploadingFiles, postId, onUploadComplete, onUploadError])

  // 파일 아이콘 선택
  const getFileIcon = (fileType: string) => {
    if (fileType.startsWith('image/')) return FiImage
    if (fileType.startsWith('video/')) return FiVideo
    if (fileType.startsWith('audio/')) return FiMusic
    return FiFile
  }

  // 파일 크기 포맷팅
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* 드래그 앤 드롭 영역 */}
      <div
        className={`
          border-2 border-dashed rounded-lg p-8 text-center transition-colors
          ${isDragOver 
            ? 'border-primary-400 bg-primary-50' 
            : 'border-gray-300 hover:border-gray-400'
          }
        `}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <FiUpload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
        <p className="text-lg font-medium text-gray-900 mb-2">
          파일을 여기로 드래그하거나 클릭하여 선택하세요
        </p>
        <p className="text-sm text-gray-500 mb-4">
          이미지, 문서, 비디오, 오디오 파일을 지원합니다 (최대 {maxFiles}개, 총 {maxTotalSize / 1024 / 1024}MB)
        </p>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 transition-colors"
        >
          <FiUpload className="w-4 h-4 mr-2" />
          파일 선택
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ALLOWED_TYPES.join(',')}
          onChange={handleInputChange}
          className="hidden"
        />
      </div>

      {/* 업로드 대기열 */}
      {uploadingFiles.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-gray-900">업로드 대기열 ({uploadingFiles.length}개)</h4>
            {uploadingFiles.length > 0 && !isUploading && (
              <button
                onClick={uploadFiles}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
              >
                모든 파일 업로드
              </button>
            )}
          </div>

          {uploadingFiles.map((uploadingFile) => {
            const FileIcon = getFileIcon(uploadingFile.file.type)
            const isImage = uploadingFile.file.type.startsWith('image/')

            return (
              <div key={uploadingFile.id} className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-start space-x-3">
                  <FileIcon className="w-8 h-8 text-gray-600 flex-shrink-0 mt-1" />
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-medium text-gray-900 truncate">
                        {uploadingFile.file.name}
                      </p>
                      <div className="flex items-center space-x-2">
                        {uploadingFile.progress === 100 && !uploadingFile.error && (
                          <FiCheck className="w-5 h-5 text-green-600" />
                        )}
                        {uploadingFile.error && (
                          <FiAlertCircle className="w-5 h-5 text-red-600" />
                        )}
                        <button
                          onClick={() => removeFile(uploadingFile.id)}
                          className="text-gray-400 hover:text-gray-600"
                        >
                          <FiX className="w-5 h-5" />
                        </button>
                      </div>
                    </div>

                    <p className="text-sm text-gray-500 mb-2">
                      {formatFileSize(uploadingFile.file.size)} • {uploadingFile.file.type}
                    </p>

                    {/* 진행률 바 */}
                    {uploadingFile.progress > 0 && (
                      <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
                        <div 
                          className={`h-2 rounded-full transition-all ${
                            uploadingFile.error 
                              ? 'bg-red-600' 
                              : uploadingFile.progress === 100 
                                ? 'bg-green-600' 
                                : 'bg-primary-600'
                          }`}
                          style={{ width: `${uploadingFile.progress}%` }}
                        />
                      </div>
                    )}

                    {/* 오류 메시지 */}
                    {uploadingFile.error && (
                      <p className="text-sm text-red-600 mb-2">{uploadingFile.error}</p>
                    )}

                    {/* 이미지 메타데이터 입력 */}
                    {isImage && !uploadingFile.error && (
                      <div className="space-y-2">
                        <input
                          type="text"
                          placeholder="이미지 설명 (선택사항)"
                          value={uploadingFile.altText || ''}
                          onChange={(e) => updateFileMetadata(uploadingFile.id, { altText: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                        />
                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            checked={uploadingFile.isPrimary || false}
                            onChange={(e) => updateFileMetadata(uploadingFile.id, { isPrimary: e.target.checked })}
                            className="mr-2"
                          />
                          <span className="text-sm text-gray-700">대표 이미지로 설정</span>
                        </label>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default PostAttachmentUploader