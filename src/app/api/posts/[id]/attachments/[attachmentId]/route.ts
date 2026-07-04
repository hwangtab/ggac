/**
 * 개별 첨부파일 관리 API
 * GET: 첨부파일 정보 조회
 * PUT: 첨부파일 정보 수정
 * DELETE: 첨부파일 삭제
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30
export const preferredRegion = 'icn1'

import { NextRequest } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createServiceRoleClient } from '@/lib/server/supabaseAdmin'
import { revalidateTag } from 'next/cache'
import { createSupabaseServer } from '@/lib/supabase/server'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { getProjectStorageObjectPath } from '@/utils/storageUrlValidation'
import { validateUUID } from '@/utils/validation'

const MAX_ALT_TEXT_LENGTH = 300

function validateAttachmentRouteParams(params: { id: string; attachmentId: string }) {
  const postIdValidation = validateUUID(params.id, '게시글 ID')
  if (!postIdValidation.isValid) {
    return {
      ok: false as const,
      response: ApiError.badRequest(postIdValidation.errors.join(', ')).toNextResponse(),
    }
  }

  const attachmentIdValidation = validateUUID(params.attachmentId, '첨부파일 ID')
  if (!attachmentIdValidation.isValid) {
    return {
      ok: false as const,
      response: ApiError.badRequest(attachmentIdValidation.errors.join(', ')).toNextResponse(),
    }
  }

  return {
    ok: true as const,
    postId: postIdValidation.sanitized,
    attachmentId: attachmentIdValidation.sanitized,
  }
}

// Service Role 클라이언트는 Storage 작업에만 사용
function getSupabaseAdmin() {
  return createServiceRoleClient()
}

/**
 * 첨부파일 정보 조회
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const resolvedParams = await context.params
  try {
    const supabase = await createSupabaseServer()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return ApiError.unauthorized('인증이 필요합니다.').toNextResponse()
    }

    const routeParams = validateAttachmentRouteParams(resolvedParams)
    if (!routeParams.ok) return routeParams.response
    const { postId, attachmentId } = routeParams

    // 첨부파일 조회
    const { data: attachment, error } = await supabase
      .from('post_attachments')
      .select('*')
      .eq('id', attachmentId)
      .eq('post_id', postId)
      .single()

    if (error || !attachment) {
      return ApiError.notFound('첨부파일을 찾을 수 없습니다.').toNextResponse()
    }

    return ApiSuccess.ok({ attachment }).toNextResponse()
  } catch (error) {
    console.error('첨부파일 조회 API 오류:', error)
    return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
  }
}

/**
 * 첨부파일 정보 수정
 */
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const resolvedParams = await context.params
  try {
    const supabase = await createSupabaseServer()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return ApiError.unauthorized('인증이 필요합니다.').toNextResponse()
    }

    const routeParams = validateAttachmentRouteParams(resolvedParams)
    if (!routeParams.ok) return routeParams.response
    const { postId, attachmentId } = routeParams
    const body = await parseJsonObjectBody(request)
    if (!body) {
      return ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse()
    }
    const { alt_text, is_primary, sort_order } = body

    if (
      alt_text !== undefined &&
      alt_text !== null &&
      (typeof alt_text !== 'string' || alt_text.length > MAX_ALT_TEXT_LENGTH)
    ) {
      return ApiError.badRequest('대체 텍스트는 300자 이하의 문자열이어야 합니다.').toNextResponse()
    }

    if (is_primary !== undefined && typeof is_primary !== 'boolean') {
      return ApiError.badRequest('대표 이미지 설정 값은 boolean이어야 합니다.').toNextResponse()
    }

    if (
      sort_order !== undefined &&
      (typeof sort_order !== 'number' ||
        !Number.isInteger(sort_order) ||
        sort_order < 0 ||
        sort_order > 10000)
    ) {
      return ApiError.badRequest(
        '정렬 순서는 0 이상 10000 이하의 정수여야 합니다.'
      ).toNextResponse()
    }

    // 첨부파일과 게시글 권한 확인
    const { data: attachment, error: attachmentError } = await supabase
      .from('post_attachments')
      .select(
        `
        *,
        posts!post_attachments_post_id_fkey(author_id, category)
      `
      )
      .eq('id', attachmentId)
      .eq('post_id', postId)
      .single()

    if (attachmentError || !attachment) {
      return ApiError.notFound('첨부파일을 찾을 수 없습니다.').toNextResponse()
    }

    if (attachment.posts.author_id !== user.id) {
      return ApiError.forbidden('권한이 없습니다.').toNextResponse()
    }

    // 대표 이미지로 설정하는 경우 기존 대표 이미지 해제
    if (is_primary && attachment.file_type === 'image') {
      await supabase
        .from('post_attachments')
        .update({ is_primary: false })
        .eq('post_id', postId)
        .eq('is_primary', true)
        .neq('id', attachmentId)
    }

    // 첨부파일 정보 업데이트
    const updateData: any = {}
    if (alt_text !== undefined) updateData.alt_text = alt_text
    if (is_primary !== undefined)
      updateData.is_primary = is_primary && attachment.file_type === 'image'
    if (sort_order !== undefined) updateData.sort_order = sort_order

    const { data: updatedAttachment, error: updateError } = await supabase
      .from('post_attachments')
      .update(updateData)
      .eq('id', attachmentId)
      .eq('post_id', postId)
      .select()
      .single()

    if (updateError) {
      console.error('첨부파일 수정 오류:', updateError)
      return ApiError.internalServerError('첨부파일 수정에 실패했습니다.').toNextResponse()
    }

    try {
      revalidateTag(`attachments-post-${postId}`)
      revalidateTag(`comments-post-${postId}`)
      revalidateTag('board-post')
      revalidateTag(postId)
      if ((attachment as any)?.posts?.category) {
        revalidateTag(`board-${(attachment as any).posts.category}`)
        revalidateTag('board-initial')
      }
    } catch {}

    return ApiSuccess.ok(
      { attachment: updatedAttachment },
      '첨부파일이 성공적으로 수정되었습니다.'
    ).toNextResponse()
  } catch (error) {
    console.error('첨부파일 수정 API 오류:', error)
    return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
  }
}

/**
 * 첨부파일 삭제
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const resolvedParams = await context.params
  try {
    const supabase = await createSupabaseServer()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return ApiError.unauthorized('인증이 필요합니다.').toNextResponse()
    }

    const routeParams = validateAttachmentRouteParams(resolvedParams)
    if (!routeParams.ok) return routeParams.response
    const { postId, attachmentId } = routeParams

    // 첨부파일과 게시글 권한 확인
    const { data: attachment, error: attachmentError } = await supabase
      .from('post_attachments')
      .select(
        `
        *,
        posts!post_attachments_post_id_fkey(author_id, category)
      `
      )
      .eq('id', attachmentId)
      .eq('post_id', postId)
      .single()

    if (attachmentError || !attachment) {
      return ApiError.notFound('첨부파일을 찾을 수 없습니다.').toNextResponse()
    }

    // 사용자 권한 확인 (작성자 또는 관리자)
    const { data: profile } = await supabase
      .from('member_profiles')
      .select('is_admin, registration_status, is_active')
      .eq('id', user.id)
      .single()

    const isAuthor = attachment.posts.author_id === user.id
    const isAdmin =
      profile?.is_admin === true &&
      profile.registration_status === 'approved' &&
      profile.is_active === true

    if (!isAuthor && !isAdmin) {
      return ApiError.forbidden('권한이 없습니다.').toNextResponse()
    }

    // Storage에서 파일 삭제 (가능한 경우에만)
    try {
      const supabaseAdmin = getSupabaseAdmin()
      const storagePath = getProjectStorageObjectPath(
        attachment.file_url,
        'attachments',
        `posts/${postId}`
      )

      if (storagePath) {
        const { error: storageError } = await supabaseAdmin.storage
          .from('attachments')
          .remove([storagePath])

        if (storageError) {
          console.warn('Storage 파일 삭제 오류:', storageError)
          // Storage 삭제 실패해도 DB 레코드는 삭제 진행
        }
      } else {
        console.warn('안전하지 않은 첨부파일 Storage URL 삭제 건너뜀:', attachmentId)
      }
    } catch (error) {
      console.warn('Storage 삭제 시도 중 오류:', error)
      // Storage 오류여도 DB 삭제는 계속 진행
    }

    // 데이터베이스에서 첨부파일 레코드 삭제
    const { error: deleteError } = await supabase
      .from('post_attachments')
      .delete()
      .eq('id', attachmentId)
      .eq('post_id', postId)

    if (deleteError) {
      console.error('첨부파일 DB 삭제 오류:', deleteError)
      return ApiError.internalServerError('첨부파일 삭제에 실패했습니다.').toNextResponse()
    }

    try {
      revalidateTag(`attachments-post-${postId}`)
      revalidateTag(`comments-post-${postId}`)
      revalidateTag('board-post')
      revalidateTag(postId)
      if ((attachment as any)?.posts?.category) {
        revalidateTag(`board-${(attachment as any).posts.category}`)
        revalidateTag('board-initial')
      }
    } catch {}

    return ApiSuccess.ok(null, '첨부파일이 성공적으로 삭제되었습니다.').toNextResponse()
  } catch (error) {
    console.error('첨부파일 삭제 API 오류:', error)
    return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
  }
}
