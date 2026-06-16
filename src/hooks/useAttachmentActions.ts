'use client'

import { useState, useCallback } from 'react'
import { useMultiLoadingState } from '@/hooks/useLoadingState'
import type { PostAttachment } from '@/types'
import { isProjectStoragePublicUrl } from '@/utils/storageUrlValidation'

interface AttachmentEditForm {
  alt_text: string
  is_primary: boolean
}

interface UseAttachmentActionsProps {
  postId: string
  onAttachmentUpdate?: (attachment: PostAttachment) => void
  onAttachmentDelete?: (attachmentId: string) => void
}

export const useAttachmentActions = ({
  postId,
  onAttachmentUpdate,
  onAttachmentDelete,
}: UseAttachmentActionsProps) => {
  const [editingAttachment, setEditingAttachment] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<AttachmentEditForm>({
    alt_text: '',
    is_primary: false,
  })

  // 다중 작업 로딩 상태 관리
  const multiLoadingState = useMultiLoadingState({
    timeout: 10000, // 10초 타임아웃
    enableLogging: true,
    onError: error => {
      console.error('첨부파일 작업 오류:', error)
      alert(error.message || '작업에 실패했습니다.')
    },
  })

  // 파일 다운로드
  const handleDownload = useCallback((attachment: PostAttachment) => {
    const safeFileUrl = isProjectStoragePublicUrl(attachment.file_url, 'attachments')
      ? attachment.file_url
      : null
    if (!safeFileUrl) return

    const link = document.createElement('a')
    link.href = safeFileUrl
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
      is_primary: attachment.is_primary,
    })
  }, [])

  // 첨부파일 수정 취소
  const cancelEdit = useCallback(() => {
    setEditingAttachment(null)
    setEditForm({ alt_text: '', is_primary: false })
  }, [])

  // 첨부파일 수정 저장
  const saveEdit = useCallback(
    async (attachmentId: string) => {
      if (!onAttachmentUpdate) return

      return multiLoadingState.executeAsync(`edit-${attachmentId}`, async () => {
        const response = await fetch(`/api/posts/${postId}/attachments/${attachmentId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(editForm),
        })

        const result = await response.json()

        if (!response.ok) {
          throw new Error(result.error || '수정에 실패했습니다.')
        }

        onAttachmentUpdate(result.attachment)
        setEditingAttachment(null)

        return result.attachment
      })
    },
    [postId, editForm, onAttachmentUpdate, multiLoadingState]
  )

  // 첨부파일 삭제
  const deleteAttachment = useCallback(
    async (attachmentId: string) => {
      if (!onAttachmentDelete) return

      if (!confirm('첨부파일을 삭제하시겠습니까?')) return

      return multiLoadingState.executeAsync(`delete-${attachmentId}`, async () => {
        const response = await fetch(`/api/posts/${postId}/attachments/${attachmentId}`, {
          method: 'DELETE',
        })

        if (!response.ok) {
          const result = await response.json()
          throw new Error(result.error || '삭제에 실패했습니다.')
        }

        onAttachmentDelete(attachmentId)

        return true
      })
    },
    [postId, onAttachmentDelete, multiLoadingState]
  )

  return {
    // State
    editingAttachment,
    editForm,

    // Loading states - 특정 작업별 로딩 상태
    isEditLoading: (attachmentId: string) =>
      multiLoadingState.getLoadingState(`edit-${attachmentId}`).isLoading,
    isDeleteLoading: (attachmentId: string) =>
      multiLoadingState.getLoadingState(`delete-${attachmentId}`).isLoading,
    isAnyLoading: multiLoadingState.isAnyLoading,
    hasAnyError: multiLoadingState.hasAnyError,
    globalError: multiLoadingState.globalError,

    // Actions
    handleDownload,
    startEdit,
    cancelEdit,
    saveEdit,
    deleteAttachment,

    // Form controls
    setEditForm,

    // Utility functions
    clearError: (attachmentId: string) => {
      multiLoadingState.clearError(`edit-${attachmentId}`)
      multiLoadingState.clearError(`delete-${attachmentId}`)
    },
    clearAllErrors: () => multiLoadingState.reset(),
  }
}
