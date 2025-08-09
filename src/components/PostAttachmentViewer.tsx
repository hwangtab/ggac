/**
 * 게시글 첨부파일 뷰어 컴포넌트
 * 업로드된 첨부파일들을 표시하고 관리하는 컴포넌트
 */

'use client'

import React, { useState, useCallback } from 'react'
import { FiImage, FiFile, FiVideo, FiMusic, FiDownload, FiEdit3, FiTrash2, FiEye, FiStar, FiX } from 'react-icons/fi'
import type { PostAttachment } from '@/types'
import OptimizedImage from './OptimizedImage'

interface PostAttachmentViewerProps {
  attachments: PostAttachment[]
  postId: string
  isAuthor?: boolean
  isAdmin?: boolean
  onAttachmentUpdate?: (attachment: PostAttachment) => void
  onAttachmentDelete?: (attachmentId: string) => void
  showActions?: boolean
  layout?: 'grid' | 'list'
  className?: string
}

interface ImageModalProps {
  attachment: PostAttachment
  onClose: () => void
}

const ImageModal: React.FC<ImageModalProps> = ({ attachment, onClose }) => {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="relative max-w-4xl max-h-full">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-white hover:text-gray-300 z-10"
        >
          <FiX className="w-8 h-8" />
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={attachment.file_url}
          alt={attachment.alt_text || attachment.file_name}
          className="max-w-full max-h-full object-contain"
        />
        {attachment.alt_text && (
          <div className="absolute bottom-4 left-4 right-4 bg-black bg-opacity-50 text-white p-3 rounded">
            <p className="text-sm">{attachment.alt_text}</p>
          </div>
        )}
      </div>
    </div>
  )
}

const PostAttachmentViewer: React.FC<PostAttachmentViewerProps> = ({
  attachments,
  postId,
  isAuthor = false,
  isAdmin = false,
  onAttachmentUpdate,
  onAttachmentDelete,
  showActions = false,
  layout = 'grid',
  className = ''
}) => {
  const [selectedImage, setSelectedImage] = useState<PostAttachment | null>(null)
  const [editingAttachment, setEditingAttachment] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<{ alt_text: string; is_primary: boolean }>({
    alt_text: '',
    is_primary: false
  })
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // 첨부파일 타입별 분류
  const imageAttachments = attachments.filter(att => att.file_type === 'image')
  const documentAttachments = attachments.filter(att => att.file_type === 'document')
  const videoAttachments = attachments.filter(att => att.file_type === 'video')
  const audioAttachments = attachments.filter(att => att.file_type === 'audio')

  // 파일 아이콘 선택
  const getFileIcon = (fileType: string) => {
    switch (fileType) {
      case 'image': return FiImage
      case 'video': return FiVideo
      case 'audio': return FiMusic
      default: return FiFile
    }
  }

  // 파일 크기 포맷팅
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  // 파일 다운로드
  const handleDownload = useCallback((attachment: PostAttachment) => {
    const link = document.createElement('a')
    link.href = attachment.file_url
    link.download = attachment.file_name
    link.target = '_blank'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }, [])

  // 첨부파일 수정 시작
  const startEdit = useCallback((attachment: PostAttachment) => {
    setEditingAttachment(attachment.id)
    setEditForm({
      alt_text: attachment.alt_text || '',
      is_primary: attachment.is_primary
    })
  }, [])

  // 첨부파일 수정 저장
  const saveEdit = useCallback(async (attachmentId: string) => {
    if (!onAttachmentUpdate) return

    try {
      setActionLoading(attachmentId)

      const response = await fetch(`/api/posts/${postId}/attachments/${attachmentId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(editForm)
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || '수정에 실패했습니다.')
      }

      onAttachmentUpdate(result.attachment)
      setEditingAttachment(null)

    } catch (error) {
      console.error('첨부파일 수정 오류:', error)
      alert(error instanceof Error ? error.message : '수정에 실패했습니다.')
    } finally {
      setActionLoading(null)
    }
  }, [editForm, postId, onAttachmentUpdate])

  // 첨부파일 수정 취소
  const cancelEdit = useCallback(() => {
    setEditingAttachment(null)
    setEditForm({ alt_text: '', is_primary: false })
  }, [])

  // 첨부파일 삭제
  const handleDelete = useCallback(async (attachmentId: string) => {
    if (!onAttachmentDelete) return
    
    if (!confirm('이 첨부파일을 삭제하시겠습니까?')) return

    try {
      setActionLoading(attachmentId)

      const response = await fetch(`/api/posts/${postId}/attachments/${attachmentId}`, {
        method: 'DELETE'
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || '삭제에 실패했습니다.')
      }

      onAttachmentDelete(attachmentId)

    } catch (error) {
      console.error('첨부파일 삭제 오류:', error)
      alert(error instanceof Error ? error.message : '삭제에 실패했습니다.')
    } finally {
      setActionLoading(null)
    }
  }, [postId, onAttachmentDelete])

  // 첨부파일 렌더링
  const renderAttachment = useCallback((attachment: PostAttachment) => {
    const FileIcon = getFileIcon(attachment.file_type)
    const isEditing = editingAttachment === attachment.id
    const isLoading = actionLoading === attachment.id
    const canEdit = showActions && (isAuthor || isAdmin)

    return (
      <div 
        key={attachment.id} 
        className={`
          relative bg-white rounded-lg border border-gray-200 overflow-hidden
          ${layout === 'grid' ? 'aspect-square' : 'flex items-center p-4'}
        `}
      >
        {/* 이미지 첨부파일 */}
        {attachment.file_type === 'image' && (
          <div 
            className={`${layout === 'grid' ? 'h-full' : 'w-16 h-16 flex-shrink-0'} cursor-pointer`}
            onClick={() => setSelectedImage(attachment)}
          >
            <OptimizedImage
              src={attachment.file_url}
              alt={attachment.alt_text || attachment.file_name}
              className={`w-full h-full object-cover ${layout === 'grid' ? '' : 'rounded'}`}
            />
            {attachment.is_primary && (
              <div className="absolute top-2 left-2 bg-yellow-500 text-white p-1 rounded">
                <FiStar className="w-4 h-4" />
              </div>
            )}
          </div>
        )}

        {/* 비이미지 첨부파일 */}
        {attachment.file_type !== 'image' && (
          <div className={`flex items-center justify-center bg-gray-100 ${
            layout === 'grid' ? 'h-full' : 'w-16 h-16 rounded'
          }`}>
            <FileIcon className="w-8 h-8 text-gray-600" />
          </div>
        )}

        {/* 첨부파일 정보 */}
        <div className={`p-3 ${layout === 'grid' ? 'absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black to-transparent text-white' : 'flex-1 ml-4'}`}>
          {isEditing ? (
            <div className="space-y-2">
              <input
                type="text"
                value={editForm.alt_text}
                onChange={(e) => setEditForm(prev => ({ ...prev, alt_text: e.target.value }))}
                placeholder="이미지 설명"
                className="w-full px-2 py-1 text-sm border border-gray-300 rounded text-gray-900"
              />
              {attachment.file_type === 'image' && (
                <label className="flex items-center text-sm">
                  <input
                    type="checkbox"
                    checked={editForm.is_primary}
                    onChange={(e) => setEditForm(prev => ({ ...prev, is_primary: e.target.checked }))}
                    className="mr-2"
                  />
                  대표 이미지
                </label>
              )}
              <div className="flex space-x-2">
                <button
                  onClick={() => saveEdit(attachment.id)}
                  disabled={isLoading}
                  className="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-50"
                >
                  저장
                </button>
                <button
                  onClick={cancelEdit}
                  disabled={isLoading}
                  className="px-2 py-1 bg-gray-600 text-white text-xs rounded hover:bg-gray-700 disabled:opacity-50"
                >
                  취소
                </button>
              </div>
            </div>
          ) : (
            <>
              <h4 className={`font-medium truncate ${layout === 'grid' ? 'text-white' : 'text-gray-900'}`}>
                {attachment.file_name}
              </h4>
              <p className={`text-sm ${layout === 'grid' ? 'text-gray-200' : 'text-gray-500'}`}>
                {formatFileSize(attachment.file_size)}
              </p>
              {attachment.alt_text && (
                <p className={`text-xs mt-1 ${layout === 'grid' ? 'text-gray-300' : 'text-gray-600'}`}>
                  {attachment.alt_text}
                </p>
              )}
            </>
          )}
        </div>

        {/* 액션 버튼들 */}
        {!isEditing && (
          <div className={`absolute top-2 right-2 flex space-x-1 ${layout === 'list' ? 'relative top-0 right-0 ml-4' : ''}`}>
            {attachment.file_type === 'image' && (
              <button
                onClick={() => setSelectedImage(attachment)}
                className="p-1 bg-black bg-opacity-50 text-white rounded hover:bg-opacity-75"
                title="크게 보기"
              >
                <FiEye className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => handleDownload(attachment)}
              className="p-1 bg-black bg-opacity-50 text-white rounded hover:bg-opacity-75"
              title="다운로드"
            >
              <FiDownload className="w-4 h-4" />
            </button>
            {canEdit && (
              <>
                <button
                  onClick={() => startEdit(attachment)}
                  disabled={isLoading}
                  className="p-1 bg-black bg-opacity-50 text-white rounded hover:bg-opacity-75 disabled:opacity-50"
                  title="수정"
                >
                  <FiEdit3 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(attachment.id)}
                  disabled={isLoading}
                  className="p-1 bg-red-600 bg-opacity-75 text-white rounded hover:bg-opacity-100 disabled:opacity-50"
                  title="삭제"
                >
                  <FiTrash2 className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        )}

        {/* 로딩 오버레이 */}
        {isLoading && (
          <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
          </div>
        )}
      </div>
    )
  }, [
    layout, editingAttachment, editForm, actionLoading, showActions, isAuthor, isAdmin,
    startEdit, saveEdit, cancelEdit, handleDelete, handleDownload, setSelectedImage
  ])

  if (attachments.length === 0) {
    return null
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* 이미지 첨부파일 */}
      {imageAttachments.length > 0 && (
        <div>
          <h4 className="font-medium text-gray-900 mb-3">이미지 ({imageAttachments.length}개)</h4>
          <div className={`
            ${layout === 'grid' 
              ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4' 
              : 'space-y-3'
            }
          `}>
            {imageAttachments.map(renderAttachment)}
          </div>
        </div>
      )}

      {/* 문서 첨부파일 */}
      {documentAttachments.length > 0 && (
        <div>
          <h4 className="font-medium text-gray-900 mb-3">문서 ({documentAttachments.length}개)</h4>
          <div className="space-y-3">
            {documentAttachments.map(renderAttachment)}
          </div>
        </div>
      )}

      {/* 비디오 첨부파일 */}
      {videoAttachments.length > 0 && (
        <div>
          <h4 className="font-medium text-gray-900 mb-3">비디오 ({videoAttachments.length}개)</h4>
          <div className="space-y-3">
            {videoAttachments.map(renderAttachment)}
          </div>
        </div>
      )}

      {/* 오디오 첨부파일 */}
      {audioAttachments.length > 0 && (
        <div>
          <h4 className="font-medium text-gray-900 mb-3">오디오 ({audioAttachments.length}개)</h4>
          <div className="space-y-3">
            {audioAttachments.map(renderAttachment)}
          </div>
        </div>
      )}

      {/* 이미지 모달 */}
      {selectedImage && (
        <ImageModal
          attachment={selectedImage}
          onClose={() => setSelectedImage(null)}
        />
      )}
    </div>
  )
}

export default PostAttachmentViewer