'use client'

import { logPostCreated } from '@/utils/activityLogger'
import { useLoadingState } from '@/hooks/useLoadingState'
import { createLogger } from '@/utils/logger'
import type { Post } from '@/types'

const log = createLogger('usePostCreation')

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
  onNewPost,
  showSuccessRedirect = false,
}: UsePostCreationProps) => {
  const loadingState = useLoadingState({
    timeout: 15000, // 15초 타임아웃
    enableLogging: true,
    onSuccess: post => {
      if (showSuccessRedirect) {
        alert('게시글이 성공적으로 작성되었습니다!')
      }
      onNewPost(post)
    },
    onError: error => {
      log.error('게시글 작성 오류:', error)
      alert(error.message || '게시글 작성에 실패했습니다.')
    },
  })

  const createPost = async (
    formData: PostFormData,
    uploadAttachmentsFn?: (postId: string) => Promise<void>
  ): Promise<string> => {
    return loadingState.executeAsync(async () => {
      // 1. 게시글 생성: 작성자/권한/캐시 무효화는 서버 API에서 일관되게 처리
      const response = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formData.title,
          content: formData.content,
          category: formData.category,
        }),
      })
      const result = (await response.json().catch(() => null)) as {
        success?: boolean
        data?: Post
        error?: string
        message?: string
      } | null

      if (!response.ok || !result?.success || !result.data) {
        throw new Error(result?.error || result?.message || '게시글 작성에 실패했습니다.')
      }

      const post = result.data
      const postId = post.id

      // 2. 활동 로깅 (비블로킹: await 제거로 타임아웃 방지)
      logPostCreated(postId, {
        category: formData.category,
        title: formData.title.substring(0, 50),
        character_count: formData.content.length,
      }).catch(logError => {
        log.error('활동 로깅 오류:', logError)
      })

      // 3. 첨부파일 업로드 (있는 경우)
      if (uploadAttachmentsFn) {
        try {
          await uploadAttachmentsFn(postId)
          log.debug('첨부파일 업로드 완료')
        } catch (uploadError) {
          log.error('첨부파일 업로드 실패:', uploadError)
          // 첨부파일 업로드 실패 시에도 게시글은 이미 생성됨을 알림
          alert(
            `게시글은 성공적으로 작성되었지만, 첨부파일 업로드에 실패했습니다.\n게시글 수정을 통해 나중에 첨부파일을 추가할 수 있습니다.`
          )
        }
      }

      // 4. 성공 처리
      onNewPost(post)

      return postId
    })
  }

  return {
    loading: loadingState.isLoading,
    error: loadingState.error,
    createPost,
    clearError: loadingState.clearError,
    reset: loadingState.reset,
  }
}
