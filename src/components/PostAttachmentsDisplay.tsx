'use client'

import React, { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { FiDownload, FiImage, FiFile, FiVideo, FiMusic, FiExternalLink } from 'react-icons/fi'
import type { PostAttachment } from '@/types'
import { useDialogA11y } from '@/hooks/useDialogA11y'
import { isProjectStoragePublicUrl } from '@/utils/storageUrlValidation'

interface PostAttachmentsDisplayProps {
  postId: string
  className?: string
  attachments?: PostAttachment[]
}

interface AttachmentWithStats {
  attachments: PostAttachment[]
  stats: {
    total_attachments: number
    total_size: number
    image_count: number
    document_count: number
    video_count: number
    audio_count: number
  }
}

type SafePostAttachment = PostAttachment & {
  safe_file_url: string
}

const PostAttachmentsDisplay: React.FC<PostAttachmentsDisplayProps> = ({
  postId,
  className = '',
  attachments: initialAttachments,
}) => {
  const [attachments, setAttachments] = useState<PostAttachment[]>(initialAttachments || [])
  const [loading, setLoading] = useState(!initialAttachments)
  const [error, setError] = useState<string | null>(null)
  const [selectedImage, setSelectedImage] = useState<PostAttachment | null>(null)

  useEffect(() => {
    if (initialAttachments) {
      setAttachments(initialAttachments)
      setLoading(false)
      return
    }
    const fetchAttachments = async () => {
      try {
        setLoading(true)
        const response = await fetch(`/api/posts/${postId}/attachments`)

        if (!response.ok) {
          throw new Error('첨부파일을 불러올 수 없습니다.')
        }

        const json = await response.json()
        const data: AttachmentWithStats = json?.data ?? json
        setAttachments(data.attachments || [])
      } catch (err) {
        console.error('첨부파일 조회 오류:', err)
        setError(err instanceof Error ? err.message : '첨부파일을 불러오는 중 오류가 발생했습니다.')
      } finally {
        setLoading(false)
      }
    }

    if (postId) {
      fetchAttachments()
    }
  }, [postId, initialAttachments])

  // 파일 타입별 아이콘 반환
  const getFileIcon = (fileType: string) => {
    switch (fileType) {
      case 'image':
        return <FiImage className="w-4 h-4" />
      case 'video':
        return <FiVideo className="w-4 h-4" />
      case 'audio':
        return <FiMusic className="w-4 h-4" />
      default:
        return <FiFile className="w-4 h-4" />
    }
  }

  // 파일 크기 포맷팅
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  // 라이트박스 닫기
  const closeLightbox = () => {
    setSelectedImage(null)
  }

  // 라이트박스 a11y: ESC, 포커스 트랩, 포커스 복원
  const lightboxRef = useRef<HTMLDivElement>(null)
  useDialogA11y({
    containerRef: lightboxRef,
    onClose: closeLightbox,
    isOpen: Boolean(selectedImage),
  })

  // 라이트박스가 열린 동안 body 스크롤 잠금
  useEffect(() => {
    if (!selectedImage) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [selectedImage])

  if (loading) {
    return (
      <div className={`animate-pulse ${className}`}>
        <div className="bg-gray-200 h-32 rounded-lg"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={`bg-red-50 border border-red-200 rounded-lg p-4 ${className}`}>
        <p className="text-red-600 text-sm">{error}</p>
      </div>
    )
  }

  if (!attachments.length) {
    return null // 첨부파일이 없으면 아무것도 표시하지 않음
  }

  // 이미지와 기타 파일 분리
  const isSafeAttachmentUrl = (url: string) => isProjectStoragePublicUrl(url, 'attachments')
  const toSafeAttachment = (attachment: PostAttachment): SafePostAttachment | null =>
    isSafeAttachmentUrl(attachment.file_url)
      ? { ...attachment, safe_file_url: attachment.file_url }
      : null
  const safeAttachments = attachments
    .map(toSafeAttachment)
    .filter((attachment): attachment is SafePostAttachment => Boolean(attachment))
  const safeImages = safeAttachments.filter(att => att.file_type === 'image')
  const safeOtherFiles = safeAttachments.filter(att => att.file_type !== 'image')

  if (!safeAttachments.length) {
    return null
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* 이미지 갤러리 */}
      {safeImages.length > 0 && (
        <div>
          <h3 className="tw-heading-tertiary mb-4 flex items-center">
            <FiImage className="w-5 h-5 mr-2" />
            이미지 ({safeImages.length})
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {safeImages.map(image => (
              <div
                key={image.id}
                className="relative group cursor-pointer rounded-lg overflow-hidden bg-gray-100 aspect-square"
                onClick={() => setSelectedImage(image)}
              >
                <Image
                  src={image.safe_file_url}
                  alt={image.alt_text || image.file_name}
                  fill
                  className="object-cover transition-transform group-hover:scale-105"
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                />

                {/* 호버 오버레이 */}
                <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all duration-200 flex items-center justify-center">
                  <FiExternalLink className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>

                {/* 대표 이미지 배지 */}
                {image.is_primary && (
                  <div className="absolute top-2 left-2 bg-blue-600 text-white text-xs px-2 py-1 rounded">
                    대표
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 기타 파일들 */}
      {safeOtherFiles.length > 0 && (
        <div>
          <h3 className="tw-heading-tertiary mb-4 flex items-center">
            <FiFile className="w-5 h-5 mr-2" />
            첨부파일 ({safeOtherFiles.length})
          </h3>

          <div className="space-y-2">
            {safeOtherFiles.map(file => (
              <div
                key={file.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center space-x-3 flex-1 min-w-0">
                  <div className="flex-shrink-0 text-gray-500">{getFileIcon(file.file_type)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{file.file_name}</p>
                    <p className="text-xs text-gray-500">
                      {formatFileSize(file.file_size)} • {file.file_type}
                    </p>
                  </div>
                </div>

                <a
                  href={file.safe_file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0 ml-4 inline-flex items-center px-3 py-1 text-xs font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
                >
                  <FiDownload className="w-3 h-3 mr-1" />
                  다운로드
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 이미지 라이트박스 모달 */}
      {selectedImage && (
        <div
          ref={lightboxRef}
          className="fixed inset-0 z-50 bg-black bg-opacity-90 flex items-center justify-center p-4"
          onClick={closeLightbox}
          role="dialog"
          aria-modal="true"
          aria-label="첨부 이미지 확대 보기"
          tabIndex={-1}
        >
          <div className="relative max-w-4xl max-h-full">
            {/* 닫기 버튼 */}
            <button
              onClick={closeLightbox}
              className="absolute top-4 right-4 z-10 text-white hover:text-gray-300 transition-colors"
            >
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>

            {/* 이미지 - 외부 업로드 이미지이므로 <img> 태그 사용 */}
            <div className="relative" onClick={e => e.stopPropagation()}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={toSafeAttachment(selectedImage)?.safe_file_url || ''}
                alt={selectedImage.alt_text || selectedImage.file_name}
                className="max-w-full max-h-[80vh] object-contain"
              />

              {/* 이미지 정보 */}
              <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-75 text-white p-4">
                <p className="font-medium">{selectedImage.file_name}</p>
                {selectedImage.alt_text && (
                  <p className="text-sm text-gray-300 mt-1">{selectedImage.alt_text}</p>
                )}
                <p className="text-xs text-gray-400 mt-1">
                  {formatFileSize(selectedImage.file_size)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default PostAttachmentsDisplay
