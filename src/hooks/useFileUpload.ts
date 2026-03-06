'use client'

import { useState, useCallback } from 'react'
import {
  validateFiles,
  FILE_VALIDATION_PROFILES,
  formatFileSize,
  getFileTypeIcon,
  formatValidationErrors,
  type FileValidationConfig,
} from '@/utils/fileUploadValidation'

interface UseFileUploadProps {
  /** 검증 프로파일 또는 커스텀 설정 */
  validationProfile?: keyof typeof FILE_VALIDATION_PROFILES | FileValidationConfig
  /** 사용자 ID (고유 파일명 생성용) */
  userId?: string
}

export const useFileUpload = ({
  validationProfile = 'POST_ATTACHMENTS',
  userId,
}: UseFileUploadProps = {}) => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [isDragOver, setIsDragOver] = useState(false)

  // 검증 설정 결정
  const validationConfig =
    typeof validationProfile === 'string'
      ? FILE_VALIDATION_PROFILES[validationProfile]
      : validationProfile

  // 파일 선택 핸들러
  const handleFileSelect = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.isArray(files) ? files : Array.from(files)

      const validation = validateFiles(fileArray, validationConfig, selectedFiles, userId)

      // 에러가 있으면 사용자에게 알림
      if (validation.errors.length > 0) {
        alert(formatValidationErrors(validation.errors))
        return
      }

      // 경고가 있으면 알림 (선택사항)
      if (validation.warnings.length > 0) {
        console.warn('파일 업로드 경고:', validation.warnings)
      }

      // 유효한 파일들만 추가
      if (validation.validFiles.length > 0) {
        setSelectedFiles(prev => [...prev, ...validation.validFiles])
      }

      // 거부된 파일들이 있으면 알림
      if (validation.rejectedFiles.length > 0) {
        const rejectedMessages = validation.rejectedFiles.map(
          ({ file, errors }) => `${file.name}: ${errors.join(', ')}`
        )
        alert(`다음 파일들이 거부되었습니다:\n${rejectedMessages.join('\n')}`)
      }
    },
    [validationConfig, selectedFiles, userId]
  )

  // 파일 제거
  const removeFile = useCallback((index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index))
  }, [])

  // 모든 파일 제거
  const clearFiles = useCallback(() => {
    setSelectedFiles([])
  }, [])

  // 드래그 앤 드롭 핸들러들
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)

      const files = e.dataTransfer.files
      if (files.length > 0) {
        handleFileSelect(files)
      }
    },
    [handleFileSelect]
  )

  // 첨부파일 업로드
  const uploadAttachments = useCallback(
    async (postId: string): Promise<void> => {
      if (selectedFiles.length === 0) return

      console.log(`[Upload] 시작: ${selectedFiles.length}개 파일 업로드`)

      const uploadPromises = selectedFiles.map(async (file, index) => {
        console.log(
          `[Upload] ${index + 1}/${selectedFiles.length}: ${file.name} (${file.type}, ${file.size} bytes)`
        )

        const formData = new FormData()
        formData.append('file', file)

        const response = await fetch(`/api/posts/${postId}/attachments`, {
          method: 'POST',
          body: formData,
        })

        console.log(`[Upload] ${file.name} 응답: ${response.status} ${response.statusText}`)

        if (!response.ok) {
          const result = await response.json().catch(() => ({ error: '응답 파싱 실패' }))
          const errorMsg = result.error || `${file.name} 업로드에 실패했습니다.`
          console.error(`[Upload] ${file.name} 실패:`, errorMsg)
          throw new Error(errorMsg)
        }

        const result = await response.json()
        console.log(`[Upload] ${file.name} 성공:`, result)
        return result
      })

      try {
        const results = await Promise.all(uploadPromises)
        console.log(`[Upload] 전체 완료: ${results.length}개 파일 성공`)
      } catch (error) {
        console.error('[Upload] 첨부파일 업로드 실패:', error)
        const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류'
        alert(`첨부파일 업로드 중 오류가 발생했습니다:\n${errorMessage}`)
        throw error
      }
    },
    [selectedFiles]
  )

  return {
    // State
    selectedFiles,
    isDragOver,

    // Actions
    handleFileSelect,
    removeFile,
    clearFiles,
    uploadAttachments,

    // Drag & Drop
    handleDragOver,
    handleDragLeave,
    handleDrop,

    // Utils (공통 유틸리티 사용)
    getFileIcon: getFileTypeIcon,
    formatFileSize,

    // Config (검증 설정에서 추출)
    maxFiles: validationConfig.maxFiles || 10,
    maxFileSize: validationConfig.maxFileSize,
    allowedTypes: validationConfig.allowedTypes,
  }
}
