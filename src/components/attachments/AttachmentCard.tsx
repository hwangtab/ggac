'use client'

import React from 'react'
import {
  FiImage,
  FiFile,
  FiVideo,
  FiMusic,
  FiDownload,
  FiEdit3,
  FiTrash2,
  FiEye,
  FiStar,
} from 'react-icons/fi'
import type { PostAttachment } from '@/types'
import OptimizedImage from '../OptimizedImage'
import { logicalPathFromUrl } from '@/lib/storage/paths'

interface AttachmentCardProps {
  attachment: PostAttachment
  showActions?: boolean
  isAuthor?: boolean
  isAdmin?: boolean
  isEditing?: boolean
  editForm?: {
    alt_text: string
    is_primary: boolean
  }
  actionLoading?: boolean
  onView?: (attachment: PostAttachment) => void
  onDownload?: (attachment: PostAttachment) => void
  onEdit?: (attachment: PostAttachment) => void
  onSave?: (attachmentId: string) => void
  onCancel?: () => void
  onDelete?: (attachmentId: string) => void
  onEditFormChange?: (form: { alt_text: string; is_primary: boolean }) => void
}

// 파일 아이콘 선택
const getFileIcon = (fileType: string) => {
  switch (fileType) {
    case 'image':
      return FiImage
    case 'video':
      return FiVideo
    case 'audio':
      return FiMusic
    default:
      return FiFile
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

export const AttachmentCard: React.FC<AttachmentCardProps> = ({
  attachment,
  showActions = false,
  isAuthor = false,
  isAdmin = false,
  isEditing = false,
  editForm,
  actionLoading = false,
  onView,
  onDownload,
  onEdit,
  onSave,
  onCancel,
  onDelete,
  onEditFormChange,
}) => {
  const FileIcon = getFileIcon(attachment.file_type)
  const canEdit = showActions && (isAuthor || isAdmin)
  const safeFileUrl =
    logicalPathFromUrl(attachment.file_url, 'attachments') !== null ? attachment.file_url : null

  if (isEditing && editForm) {
    return (
      <div className="relative bg-white rounded-lg border-2 border-blue-200 p-4">
        <div className="space-y-3">
          {/* Alt Text 편집 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">설명 (Alt Text)</label>
            <input
              type="text"
              value={editForm.alt_text}
              onChange={e => onEditFormChange?.({ ...editForm, alt_text: e.target.value })}
              placeholder="이미지 설명을 입력하세요"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Primary 설정 (이미지만) */}
          {attachment.file_type === 'image' && (
            <div className="flex items-center">
              <input
                type="checkbox"
                id={`primary-${attachment.id}`}
                checked={editForm.is_primary}
                onChange={e => onEditFormChange?.({ ...editForm, is_primary: e.target.checked })}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label htmlFor={`primary-${attachment.id}`} className="ml-2 text-sm text-gray-700">
                대표 이미지로 설정
              </label>
            </div>
          )}

          {/* 액션 버튼 */}
          <div className="flex justify-end space-x-2 pt-2">
            <button
              onClick={onCancel}
              disabled={actionLoading}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50"
            >
              취소
            </button>
            <button
              onClick={() => onSave?.(attachment.id)}
              disabled={actionLoading}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {actionLoading ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
      {/* 파일 내용 */}
      <div className="p-3">
        {attachment.file_type === 'image' && safeFileUrl ? (
          <div
            className="aspect-square mb-3 bg-gray-100 rounded-lg overflow-hidden cursor-pointer hover:scale-105 transition-transform"
            onClick={() => onView?.(attachment)}
          >
            <OptimizedImage
              src={safeFileUrl}
              alt={attachment.alt_text || attachment.file_name}
              width={200}
              height={200}
              className="w-full h-full object-cover"
            />
          </div>
        ) : (
          <div className="flex items-center justify-center aspect-square mb-3 bg-gray-50 rounded-lg">
            <FileIcon className="w-12 h-12 text-gray-400" />
          </div>
        )}

        {/* 파일 정보 */}
        <div className="space-y-1">
          <h4 className="text-sm font-medium text-gray-900 truncate" title={attachment.file_name}>
            {attachment.file_name}
          </h4>
          <p className="text-xs text-gray-500">{formatFileSize(attachment.file_size)}</p>
          {attachment.alt_text && (
            <p className="text-xs text-gray-600 line-clamp-2" title={attachment.alt_text}>
              {attachment.alt_text}
            </p>
          )}
        </div>

        {/* Primary 배지 */}
        {attachment.is_primary && (
          <div className="absolute top-2 left-2 bg-yellow-500 text-white px-1.5 py-0.5 rounded text-xs flex items-center">
            <FiStar className="w-3 h-3 mr-1" />
            대표
          </div>
        )}
      </div>

      {/* 액션 버튼들 */}
      {showActions && (
        <div className="px-3 pb-3">
          <div className="flex flex-wrap gap-1">
            {/* 보기 버튼 (이미지만) */}
            {attachment.file_type === 'image' && safeFileUrl && (
              <button
                onClick={() => onView?.(attachment)}
                className="flex items-center px-2 py-1 text-xs text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                title="이미지 크게 보기"
              >
                <FiEye className="w-3 h-3 mr-1" />
                보기
              </button>
            )}

            {/* 다운로드 버튼 */}
            <button
              onClick={() => onDownload?.(attachment)}
              disabled={!safeFileUrl}
              className="flex items-center px-2 py-1 text-xs text-gray-600 hover:text-green-600 hover:bg-green-50 rounded transition-colors"
              title="다운로드"
            >
              <FiDownload className="w-3 h-3 mr-1" />
              다운로드
            </button>

            {/* 수정 버튼 (작성자/관리자만) */}
            {canEdit && (
              <button
                onClick={() => onEdit?.(attachment)}
                disabled={actionLoading}
                className="flex items-center px-2 py-1 text-xs text-gray-600 hover:text-orange-600 hover:bg-orange-50 rounded transition-colors disabled:opacity-50"
                title="수정"
              >
                <FiEdit3 className="w-3 h-3 mr-1" />
                수정
              </button>
            )}

            {/* 삭제 버튼 (작성자/관리자만) */}
            {canEdit && (
              <button
                onClick={() => onDelete?.(attachment.id)}
                disabled={actionLoading}
                className="flex items-center px-2 py-1 text-xs text-gray-600 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                title="삭제"
              >
                <FiTrash2 className="w-3 h-3 mr-1" />
                삭제
              </button>
            )}
          </div>
        </div>
      )}

      {/* 로딩 오버레이 */}
      {actionLoading && (
        <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
      )}
    </div>
  )
}
