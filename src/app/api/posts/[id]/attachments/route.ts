/**
 * 게시글 첨부파일 관리 API
 * GET: 첨부파일 목록 조회
 * POST: 첨부파일 업로드
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30
export const preferredRegion = 'icn1'

import { NextRequest } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { rateLimit } from '@/lib/server/rateLimit'
import { putPublicObject, deletePublicObject } from '@/lib/storage/provider'
import { revalidateTag } from 'next/cache'
import type { PostAttachmentStats } from '@/types'
import { createSupabaseServer } from '@/lib/supabase/server'
import { validateUUID, validateUUIDOrTempId, isValidTempId } from '@/utils/validation'
import { generateUniqueFileName } from '@/utils/fileNameSanitizer'
import {
  validateFile,
  FILE_VALIDATION_PROFILES,
  formatValidationErrors,
  hasValidFileSignature,
} from '@/utils/fileUploadValidation'

/**
 * 첨부파일 목록 조회
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resolvedParams = await context.params
  try {
    const postId = resolvedParams.id

    // 임시 게시글 작성 중 첨부 업로드는 temp-{UUID}도 명시적으로 허용한다.
    const uuidValidation = validateUUIDOrTempId(postId, '게시글 ID')
    if (!uuidValidation.isValid) {
      return ApiError.badRequest(
        uuidValidation.errors[0] || '잘못된 게시글 ID 형식입니다.'
      ).toNextResponse()
    }

    const validPostId = uuidValidation.sanitized

    // 공개 읽기 허용: 인증 없이도 첨부파일 목록을 조회할 수 있게 함
    // (쓰기/업로드는 계속 보호됨)
    const supabase = await createSupabaseServer()

    // 게시글 존재 확인
    const { data: post, error: postError } = await supabase
      .from('posts')
      .select('id, author_id')
      .eq('id', validPostId)
      .eq('is_deleted', false)
      .single()

    if (postError || !post) {
      return ApiError.notFound('게시글을 찾을 수 없습니다.').toNextResponse()
    }

    // 첨부파일 목록 조회
    const { data: attachments, error: attachmentsError } = await supabase
      .from('post_attachments')
      .select('*')
      .eq('post_id', validPostId)
      .order('sort_order', { ascending: true })

    if (attachmentsError) {
      console.error('첨부파일 조회 오류:', attachmentsError)
      return ApiError.internalServerError('첨부파일을 조회할 수 없습니다.').toNextResponse()
    }

    // 첨부파일 통계 계산 (클라이언트 사이드에서)
    let stats: PostAttachmentStats = {
      total_attachments: attachments?.length || 0,
      total_size: attachments?.reduce((sum, att) => sum + att.file_size, 0) || 0,
      image_count: attachments?.filter(att => att.file_type === 'image').length || 0,
      document_count: attachments?.filter(att => att.file_type === 'document').length || 0,
      video_count: attachments?.filter(att => att.file_type === 'video').length || 0,
      audio_count: attachments?.filter(att => att.file_type === 'audio').length || 0,
    }

    return ApiSuccess.ok({
      attachments: attachments || [],
      stats,
    }).toNextResponse()
  } catch (error) {
    console.error('첨부파일 조회 API 오류:', error)
    return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
  }
}

/**
 * 첨부파일 업로드
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  // 업로드 무한 반복 시 Storage 비용·DB 부하 방지 (전수감사 안정성 M-4)
  const rl = await rateLimit(request, 'FILE_UPLOAD')
  if (!rl.success) {
    return rl.response ?? ApiError.tooManyRequests('요청이 너무 많습니다.').toNextResponse()
  }

  const resolvedParams = await context.params
  try {
    const postId = resolvedParams.id

    // UUID 형식 검증
    const uuidValidation = validateUUID(postId, '게시글 ID')
    if (!uuidValidation.isValid) {
      console.error('[UPLOAD API] UUID 검증 실패:', uuidValidation.errors)
      return ApiError.badRequest(
        uuidValidation.errors[0] || '잘못된 게시글 ID 형식입니다.'
      ).toNextResponse()
    }

    const supabase = await createSupabaseServer()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      console.error('[UPLOAD API] 인증 실패 - 세션 없음')
      return ApiError.unauthorized('인증이 필요합니다.').toNextResponse()
    }

    const validPostId = uuidValidation.sanitized
    const isTempId = isValidTempId(validPostId)

    // 임시 ID가 아닌 경우에만 게시글 존재 및 권한 확인
    let post = null
    if (!isTempId) {
      const { data: postData, error: postError } = await supabase
        .from('posts')
        .select('id, author_id, category')
        .eq('id', validPostId)
        .single()

      if (postError || !postData) {
        console.error('[UPLOAD API] 게시글 조회 실패:', postError)
        return ApiError.notFound('게시글을 찾을 수 없습니다.').toNextResponse()
      }

      if (postData.author_id !== user.id) {
        console.error('[UPLOAD API] 권한 없음 - 작성자가 아님')
        return ApiError.forbidden(
          '게시글 작성자만 첨부파일을 업로드할 수 있습니다.'
        ).toNextResponse()
      }

      post = postData
    }

    // 멀티파트 폼 데이터 파싱
    const formData = await request.formData()
    const file = formData.get('file') as File
    const altText = (formData.get('alt_text') as string) || ''
    const isPrimary = formData.get('is_primary') === 'true'

    if (!file || file.size === 0) {
      console.error('[UPLOAD API] 파일이 없음')
      return ApiError.badRequest('파일이 선택되지 않았습니다.').toNextResponse()
    }

    // 공통 파일 검증 로직 사용
    const validation = validateFile(file, FILE_VALIDATION_PROFILES.POST_ATTACHMENTS, [], user.id)

    if (!validation.isValid) {
      return ApiError.badRequest(formatValidationErrors(validation.errors)).toNextResponse()
    }

    // 파일 타입 추출 (검증에서 이미 확인됨)
    const fileType = validation.fileType!

    // 임시 ID가 아닌 경우에만 첨부파일 제한 확인
    if (!isTempId) {
      const { data: existingAttachments, error: existingError } = await supabase
        .from('post_attachments')
        .select('file_size')
        .eq('post_id', validPostId)

      if (existingError) {
        console.error('기존 첨부파일 조회 오류:', existingError)
        return ApiError.internalServerError('첨부파일 제한 확인에 실패했습니다.').toNextResponse()
      }

      const currentCount = existingAttachments?.length || 0
      const currentTotalSize =
        existingAttachments?.reduce((sum, att) => sum + att.file_size, 0) || 0

      // 검증 설정에서 제한값 가져오기
      const config = FILE_VALIDATION_PROFILES.POST_ATTACHMENTS

      // 제한 확인
      if (currentCount >= (config.maxFiles || 10)) {
        return ApiError.badRequest(
          `첨부파일 개수 제한을 초과했습니다. (최대 ${config.maxFiles}개)`
        ).toNextResponse()
      }

      if (config.maxTotalSize && currentTotalSize + file.size > config.maxTotalSize) {
        return ApiError.badRequest(
          `첨부파일 총 크기 제한을 초과했습니다. (최대 ${config.maxTotalSize / 1024 / 1024}MB)`
        ).toNextResponse()
      }
    }

    // 파일명 정제 및 고유 파일명 생성 (공통 검증에서 이미 생성됨)
    const uniqueFileName = validation.uniqueFileName || generateUniqueFileName(file.name)

    // 파일을 Supabase Storage에 업로드
    const fileBuffer = Buffer.from(await file.arrayBuffer())
    if (!hasValidFileSignature(fileBuffer, file.type)) {
      return ApiError.badRequest(
        '파일 내용이 선언된 파일 형식과 일치하지 않습니다.'
      ).toNextResponse()
    }

    // 임시 파일과 영구 파일의 경로 구분
    const filePath = isTempId
      ? `temp/${validPostId}/${uniqueFileName}`
      : `posts/${validPostId}/${uniqueFileName}`

    let fileUrl: string
    try {
      const { url } = await putPublicObject(`attachments/${filePath}`, fileBuffer, file.type)
      fileUrl = url
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[UPLOAD API] Storage 업로드 실패:', { error, message })

      // Storage bucket이 없는 경우 특별한 메시지
      if (message.includes('bucket') || message.includes('not found')) {
        return ApiError.serviceUnavailable(
          'Storage가 설정되지 않았습니다. 관리자가 Supabase Storage bucket을 생성해야 합니다.'
        ).toNextResponse()
      }
      return ApiError.internalServerError('파일 업로드에 실패했습니다.').toNextResponse()
    }

    // 임시 파일이 아닌 경우에만 데이터베이스 저장
    if (!isTempId) {
      // 대표 이미지로 설정하는 경우 기존 대표 이미지 해제
      if (isPrimary && fileType === 'image') {
        const { error: primaryError } = await supabase
          .from('post_attachments')
          .update({ is_primary: false })
          .eq('post_id', validPostId)
          .eq('is_primary', true)

        if (primaryError) {
          console.warn('[UPLOAD API] 기존 대표 이미지 해제 실패:', primaryError)
        }
      }

      // 첨부파일 메타데이터를 데이터베이스에 저장
      const attachmentData = {
        post_id: validPostId,
        file_name: file.name,
        file_url: fileUrl,
        file_type: fileType,
        file_size: file.size,
        mime_type: file.type,
        alt_text: altText || null,
        is_primary: isPrimary && fileType === 'image',
      }

      const { data: attachment, error: dbError } = await supabase
        .from('post_attachments')
        .insert(attachmentData)
        .select()
        .single()

      if (dbError) {
        console.error('[UPLOAD API] 메타데이터 저장 실패:', {
          error: dbError,
          message: dbError.message,
          code: dbError.code,
          details: dbError.details,
        })

        // 업로드된 파일 삭제 (롤백) — 방금 이 요청에서 현재 제공자로
        // 올린 파일을 되돌리는 것이므로 단일 제공자 삭제로 충분하다.
        try {
          await deletePublicObject(`attachments/${filePath}`)
        } catch (rollbackError) {
          console.error('[UPLOAD API] 파일 롤백 실패:', rollbackError)
        }

        return ApiError.internalServerError('첨부파일 정보 저장에 실패했습니다.').toNextResponse()
      }

      try {
        revalidateTag(`attachments-post-${validPostId}`)
        revalidateTag(`comments-post-${validPostId}`)
        revalidateTag('board-post')
        revalidateTag(validPostId)
        if ((post as any)?.category) {
          revalidateTag(`board-${(post as any).category}`)
          revalidateTag('board-initial')
        }
      } catch {}

      return ApiSuccess.ok(
        { attachment },
        '첨부파일이 성공적으로 업로드되었습니다.'
      ).toNextResponse()
    } else {
      // 임시 파일의 경우 임시 첨부파일로 데이터베이스에 저장

      // 24시간 후 만료 설정
      const expiresAt = new Date()
      expiresAt.setHours(expiresAt.getHours() + 24)

      const tempAttachmentData = {
        post_id: validPostId, // 임시 ID
        file_name: file.name,
        file_url: fileUrl,
        file_type: fileType,
        file_size: file.size,
        mime_type: file.type,
        alt_text: altText || null,
        is_primary: false, // 임시 파일은 대표 이미지가 될 수 없음
        is_temporary: true,
        temp_session: user.id, // 사용자 ID를 세션으로 사용
        expires_at: expiresAt.toISOString(),
      }

      const { data: tempAttachment, error: tempDbError } = await supabase
        .from('post_attachments')
        .insert(tempAttachmentData)
        .select()
        .single()

      if (tempDbError) {
        console.error('[UPLOAD API] 임시 첨부파일 저장 실패:', tempDbError)

        // 실패 시 업로드된 파일 삭제 — 방금 이 요청에서 현재 제공자로
        // 올린 파일을 되돌리는 것이므로 단일 제공자 삭제로 충분하다.
        try {
          await deletePublicObject(`attachments/${filePath}`)
        } catch (rollbackError) {
          console.error('[UPLOAD API] 임시 파일 롤백 실패:', rollbackError)
        }

        return ApiError.internalServerError('임시 이미지 저장에 실패했습니다.').toNextResponse()
      }

      return ApiSuccess.ok(
        {
          url: fileUrl,
          attachment: tempAttachment,
          tempId: validPostId,
          expiresAt: expiresAt.toISOString(),
        },
        '임시 이미지가 성공적으로 업로드되었습니다.'
      ).toNextResponse()
    }
  } catch (error) {
    console.error('[UPLOAD API] 예외 발생:', {
      error,
      message: error instanceof Error ? error.message : '알 수 없는 오류',
      stack: error instanceof Error ? error.stack : undefined,
    })
    return ApiError.internalServerError('서버 오류가 발생했습니다.').toNextResponse()
  }
}
