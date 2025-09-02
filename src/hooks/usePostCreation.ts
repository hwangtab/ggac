'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import { logPostCreated } from '@/utils/activityLogger'
import { useLoadingState } from '@/hooks/useLoadingState'
import type { Post } from '@/types'

interface UsePostCreationProps {
  authorId: string
  onNewPost: (post: Post) => void
  showSuccessRedirect?: boolean
}

interface PostFormData {
  title: string
  content: string
  category: string
}

export const usePostCreation = ({
  authorId,
  onNewPost,
  showSuccessRedirect = false
}: UsePostCreationProps) => {
  const loadingState = useLoadingState({
    timeout: 15000, // 15초 타임아웃
    enableLogging: true,
    onSuccess: (post) => {
      if (showSuccessRedirect) {
        alert('게시글이 성공적으로 작성되었습니다!')
      }
      onNewPost(post)
    },
    onError: (error) => {
      console.error('게시글 작성 오류:', error)
      alert(error.message || '게시글 작성에 실패했습니다.')
    }
  })

  const createPost = async (
    formData: PostFormData,
    uploadAttachmentsFn?: (postId: string) => Promise<void>
  ): Promise<string> => {
    return loadingState.executeAsync(async () => {
      // 1. 게시글 생성 (공지 카테고리인 경우 자동으로 핀 설정)
      const postData = {
        title: formData.title,
        content: formData.content,
        content_format: 'html', // 항상 HTML 형식 사용
        category: formData.category,
        author_id: authorId,
        ...(formData.category === '공지' && {
          is_pinned: true,
          pinned_at: new Date().toISOString()
        })
      }

      const { data, error } = await supabase
        .from('posts')
        .insert([postData])
        .select()
        .single()

      if (error) {
        throw new Error(error.message)
      }

      const postId = (data as unknown as Post).id

      // 2. 활동 로깅
      try {
        await logPostCreated(postId, {
          category: formData.category,
          title: formData.title.substring(0, 50),
          character_count: formData.content.length
        })
      } catch (logError) {
        console.error('활동 로깅 오류:', logError)
      }

      // 3. 첨부파일 업로드 (있는 경우)
      if (uploadAttachmentsFn) {
        try {
          await uploadAttachmentsFn(postId)
          console.log('[Submit] 첨부파일 업로드 완료')
        } catch (uploadError) {
          console.error('[Submit] 첨부파일 업로드 실패:', uploadError)
          // 첨부파일 업로드 실패 시에도 게시글은 이미 생성됨을 알림
          alert(`게시글은 성공적으로 작성되었지만, 첨부파일 업로드에 실패했습니다.\n게시글 수정을 통해 나중에 첨부파일을 추가할 수 있습니다.`)
        }
      }

      // 4. 성공 처리
      if (showSuccessRedirect) {
        alert('게시글이 성공적으로 작성되었습니다!')
      }

      onNewPost(data as unknown as Post)

      return postId
    })
  }

  return {
    loading: loadingState.isLoading,
    error: loadingState.error,
    createPost,
    clearError: loadingState.clearError,
    reset: loadingState.reset
  }
}