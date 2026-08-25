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

import { NextRequest, NextResponse } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { revalidateTag } from 'next/cache'
import { parseJsonObjectBody } from '@/utils/requestBody'
import { deletePublicObjectEverywhere, logicalPathFromUrl } from '@/lib/storage/provider'
import { validateUUID } from '@/utils/validation'
import { requireUser } from '@/lib/server/memberAuth'
import { getProfileById } from '@/db/queries/profiles'
import {
  getAttachmentById,
  getAttachmentWithPost,
  unsetPrimaryForPost,
  updateAttachment,
  removeAttachment,
} from '@/db/queries/attachments'

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

/**
 * 첨부파일 정보 조회
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const resolvedParams = await context.params
  try {
    // 첨부파일 조회는 로그인만 확인한다.
    const auth = await requireUser()
    if (auth instanceof NextResponse) return auth

    const routeParams = validateAttachmentRouteParams(resolvedParams)
    if (!routeParams.ok) return routeParams.response
    const { postId, attachmentId } = routeParams

    // 첨부파일 조회. 단계 2c(Task 5): Supabase
    // `.eq('id', attachmentId).eq('post_id', postId)`에서 Turso 쿼리 계층
    // getAttachmentById(attachmentId, postId)로 옮겼다.
    const attachment = await getAttachmentById(attachmentId, postId).catch(() => null)

    if (!attachment) {
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
    // 첨부파일 수정은 로그인만 확인한다(승인 여부는 보지 않음). 작성자
    // 소유권 확인은 아래에서 별도로 한다.
    const auth = await requireUser()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

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

    // 첨부파일과 게시글 권한 확인. 단계 2c(Task 5): Supabase
    // `.select('*, posts!post_attachments_post_id_fkey(author_id, category)')`
    // 에서 Turso 쿼리 계층 getAttachmentWithPost(attachmentId, postId)로
    // 옮겼다 — `attachment.posts.author_id` 접근 형태를 그대로 보존한다.
    const attachment = await getAttachmentWithPost(attachmentId, postId).catch(() => null)

    if (!attachment || !attachment.posts) {
      return ApiError.notFound('첨부파일을 찾을 수 없습니다.').toNextResponse()
    }

    if (attachment.posts.author_id !== user.id) {
      return ApiError.forbidden('권한이 없습니다.').toNextResponse()
    }

    // 대표 이미지로 설정하는 경우 기존 대표 이미지 해제. 단계 2c(Task 5):
    // Supabase `.eq('post_id', postId).eq('is_primary', true).neq('id',
    // attachmentId)`에서 Turso 쿼리 계층
    // unsetPrimaryForPost(postId, attachmentId)로 옮겼다(자기 자신은 제외).
    if (is_primary && attachment.file_type === 'image') {
      await unsetPrimaryForPost(postId, attachmentId)
    }

    // 첨부파일 정보 업데이트. 단계 2c(Task 5): Supabase
    // `.update(updateData).eq('id', attachmentId).eq('post_id', postId)`에서
    // Turso 쿼리 계층 updateAttachment(attachmentId, postId, patch)로 옮겼다.
    const patch: { alt_text?: string | null; is_primary?: boolean; sort_order?: number } = {}
    // 위에서 이미 런타임으로 형식을 검증했다(문자열 길이/boolean/정수 범위) —
    // 여기서는 그 검증을 통과한 값만 patch로 옮기므로 as로 좁힌다.
    if (alt_text !== undefined) patch.alt_text = alt_text as string | null
    if (is_primary !== undefined)
      patch.is_primary = Boolean(is_primary) && attachment.file_type === 'image'
    if (sort_order !== undefined) patch.sort_order = sort_order as number

    let updatedAttachment
    try {
      updatedAttachment = await updateAttachment(attachmentId, postId, patch)
    } catch (updateError) {
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
    // 첨부파일 삭제는 로그인만 확인한다(승인 여부는 보지 않음). 작성자
    // 또는 관리자 권한 확인은 아래에서 별도로 한다.
    const auth = await requireUser()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    const routeParams = validateAttachmentRouteParams(resolvedParams)
    if (!routeParams.ok) return routeParams.response
    const { postId, attachmentId } = routeParams

    // 첨부파일과 게시글 권한 확인. 단계 2c(Task 5): Supabase
    // `.select('*, posts!post_attachments_post_id_fkey(author_id, category)')`
    // 에서 Turso 쿼리 계층 getAttachmentWithPost(attachmentId, postId)로
    // 옮겼다.
    const attachment = await getAttachmentWithPost(attachmentId, postId).catch(() => null)

    if (!attachment || !attachment.posts) {
      return ApiError.notFound('첨부파일을 찾을 수 없습니다.').toNextResponse()
    }

    // 사용자 권한 확인 (작성자 또는 관리자). 단계 2c(Task 5): member_profiles
    // 조회를 Supabase `.eq('id', user.id)`에서 Turso 쿼리 계층
    // getProfileById(user.id)로 옮겼다 — 조건식(is_admin &&
    // registration_status==='approved' && is_active)은 문자 그대로 보존.
    const profile = await getProfileById(user.id).catch(() => null)

    const isAuthor = attachment.posts.author_id === user.id
    const isAdmin =
      profile?.is_admin === true &&
      profile.registration_status === 'approved' &&
      profile.is_active === true

    if (!isAuthor && !isAdmin) {
      return ApiError.forbidden('권한이 없습니다.').toNextResponse()
    }

    // Storage에서 파일 삭제 (가능한 경우에만) — 전환기에는 이 첨부파일이
    // 어느 제공자에 있는지 알 수 없으므로 양쪽 다 지운다. 버킷·접두사
    // 봉쇄(attachments 버킷, posts/<postId> 하위)는 logicalPathFromUrl이
    // 그대로 유지한다.
    try {
      const logical = logicalPathFromUrl(attachment.file_url, 'attachments', `posts/${postId}`)

      if (logical) {
        await deletePublicObjectEverywhere(logical)
      } else {
        console.warn('안전하지 않은 첨부파일 Storage URL 삭제 건너뜀:', attachmentId)
      }
    } catch (error) {
      console.warn('Storage 삭제 시도 중 오류:', error)
      // Storage 오류여도 DB 삭제는 계속 진행
    }

    // 데이터베이스에서 첨부파일 레코드 삭제. 단계 2c(Task 5): Supabase
    // `.delete().eq('id', attachmentId).eq('post_id', postId)`에서 Turso
    // 쿼리 계층 removeAttachment(attachmentId, postId)로 옮겼다.
    try {
      await removeAttachment(attachmentId, postId)
    } catch (deleteError) {
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
