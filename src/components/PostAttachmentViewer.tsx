/**
 * 게시글 첨부파일 뷰어 컴포넌트
 * 업로드된 첨부파일들을 표시하고 관리하는 컴포넌트
 */

'use client'

import React, { useState } from 'react'
import type { PostAttachment } from '@/types'
import { ImageModal } from './attachments/ImageModal'
import { AttachmentCard } from './attachments/AttachmentCard'
import { useAttachmentActions } from '@/hooks/useAttachmentActions'

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

const PostAttachmentViewer: React.FC<PostAttachmentViewerProps> = ({
  attachments,
  postId,
  isAuthor = false,
  isAdmin = false,
  onAttachmentUpdate,
  onAttachmentDelete,
  showActions = false,
  layout = 'grid',
  className = '',
}) => {
  const [selectedImage, setSelectedImage] = useState<PostAttachment | null>(null)

  const {
    editingAttachment,
    editForm,
    isEditLoading,
    isDeleteLoading,
    isAnyLoading,
    handleDownload,
    startEdit,
    cancelEdit,
    saveEdit,
    deleteAttachment,
    setEditForm,
  } = useAttachmentActions({
    postId,
    onAttachmentUpdate,
    onAttachmentDelete,
  })

  // 첨부파일 타입별 분류
  const imageAttachments = attachments.filter(att => att.file_type === 'image')
  const documentAttachments = attachments.filter(att => att.file_type === 'document')
  const videoAttachments = attachments.filter(att => att.file_type === 'video')
  const audioAttachments = attachments.filter(att => att.file_type === 'audio')

  // 첨부파일이 없는 경우
  if (attachments.length === 0) {
    return null
  }

  const allAttachments = [
    ...imageAttachments,
    ...videoAttachments,
    ...audioAttachments,
    ...documentAttachments,
  ]

  return (
    <div className={`${className}`}>
      {/* 첨부파일 그리드/리스트 */}
      <div
        className={`
        ${
          layout === 'grid'
            ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4'
            : 'space-y-3'
        }
      `}
      >
        {allAttachments.map(attachment => (
          <AttachmentCard
            key={attachment.id}
            attachment={attachment}
            showActions={showActions}
            isAuthor={isAuthor}
            isAdmin={isAdmin}
            isEditing={editingAttachment === attachment.id}
            editForm={editForm}
            actionLoading={isEditLoading(attachment.id) || isDeleteLoading(attachment.id)}
            onView={setSelectedImage}
            onDownload={handleDownload}
            onEdit={startEdit}
            onSave={saveEdit}
            onCancel={cancelEdit}
            onDelete={deleteAttachment}
            onEditFormChange={setEditForm}
          />
        ))}
      </div>

      {/* 이미지 모달 */}
      {selectedImage && (
        <ImageModal attachment={selectedImage} onClose={() => setSelectedImage(null)} />
      )}
    </div>
  )
}

export default PostAttachmentViewer
