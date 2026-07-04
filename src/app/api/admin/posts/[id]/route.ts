export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30
export const preferredRegion = 'icn1'

import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { validateUUID } from '@/utils/validation'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'

type PostActionBody = Record<string, unknown>

export const PATCH = defineApiRoute<PostActionBody>({
  method: 'PATCH',
  name: 'api/admin/posts/[id]',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_posts_action'),
  },
  rateLimitHeaders: true,
  auth: 'admin',
  body: {
    invalidResponse: () => ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse(),
  },
  errorResponse: error => {
    console.error('Admin posts [ID] - API error:', error)
    return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
  },
  handler: async ({ params, body, auth }) => {
    const resolvedParams = { id: typeof params.id === 'string' ? params.id : '' }
    const { db } = auth

    const uuidValidation = validateUUID(resolvedParams.id, '게시글 ID')
    if (!uuidValidation.isValid) {
      return ApiError.badRequest(uuidValidation.errors.join(', ')).toNextResponse()
    }
    const postId = uuidValidation.sanitized

    const action = typeof body.action === 'string' ? body.action : ''

    if (!action || !['delete', 'restore', 'pin', 'unpin'].includes(action)) {
      return ApiError.badRequest('잘못된 작업입니다.').toNextResponse()
    }

    // Get the post to check if it exists
    const { data: post } = await db
      .from('posts')
      .select('id, category, is_deleted, is_pinned')
      .eq('id', postId)
      .single()

    if (!post) {
      return ApiError.notFound('게시글을 찾을 수 없습니다.').toNextResponse()
    }

    // Prepare update data based on action
    let updateData: any = {}

    switch (action) {
      case 'delete':
        if (post.is_deleted) {
          return ApiError.badRequest('이미 삭제된 게시글입니다.').toNextResponse()
        }
        updateData = { is_deleted: true }
        break

      case 'restore':
        if (!post.is_deleted) {
          return ApiError.badRequest('삭제되지 않은 게시글입니다.').toNextResponse()
        }
        updateData = { is_deleted: false }
        break

      case 'pin':
        if (post.category !== '공지') {
          return ApiError.badRequest('공지사항만 고정할 수 있습니다.').toNextResponse()
        }
        if (post.is_pinned) {
          return ApiError.badRequest('이미 고정된 게시글입니다.').toNextResponse()
        }
        updateData = {
          is_pinned: true,
          pinned_at: new Date().toISOString(),
        }
        break

      case 'unpin':
        if (!post.is_pinned) {
          return ApiError.badRequest('고정되지 않은 게시글입니다.').toNextResponse()
        }
        updateData = {
          is_pinned: false,
          pinned_at: null,
        }
        break
    }

    // Update the post
    const { data: updatedPost, error: updateError } = await db
      .from('posts')
      .update(updateData)
      .eq('id', postId)
      .select()
      .single()

    if (updateError) {
      console.error('Admin posts [ID] - Post update error:', updateError)
      return ApiError.internalServerError('게시글 업데이트에 실패했습니다.').toNextResponse()
    }

    const actionMessage =
      action === 'delete'
        ? '삭제'
        : action === 'restore'
          ? '복원'
          : action === 'pin'
            ? '고정'
            : '고정 해제'

    return ApiSuccess.ok({ post: updatedPost }, `게시글 ${actionMessage}가 완료되었습니다.`)
  },
})
