'use client'

import { useState, useCallback } from 'react'
import type { PostAttachment } from '@/types'

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
  onAttachmentDelete
}: UseAttachmentActionsProps) => {
  const [editingAttachment, setEditingAttachment] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<AttachmentEditForm>({
    alt_text: '',
    is_primary: false
  })
  const [actionLoading, setActionLoading] = useState<string | null>(null)

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

  // 첨부파일 수정 취소
  const cancelEdit = useCallback(() => {
    setEditingAttachment(null)
    setEditForm({ alt_text: '', is_primary: false })
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
  }, [postId, editForm, onAttachmentUpdate])

  // 첨부파일 삭제
  const deleteAttachment = useCallback(async (attachmentId: string) => {
    if (!onAttachmentDelete) return

    if (!confirm('첨부파일을 삭제하시겠습니까?')) return

    try {
      setActionLoading(attachmentId)

      const response = await fetch(`/api/posts/${postId}/attachments/${attachmentId}`, {
        method: 'DELETE'
      })

      if (!response.ok) {
        const result = await response.json()
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

  return {
    // State
    editingAttachment,
    editForm,
    actionLoading,
    
    // Actions
    handleDownload,
    startEdit,
    cancelEdit,
    saveEdit,
    deleteAttachment,
    
    // Form controls
    setEditForm
  }
}