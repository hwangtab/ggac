/**
 * 게시글 첨부파일 관리 API
 * GET: 첨부파일 목록 조회
 * POST: 첨부파일 업로드
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30
export const preferredRegion = 'icn1'

import { NextRequest, NextResponse } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { rateLimit } from '@/lib/server/rateLimit'
import { requireUser } from '@/lib/server/memberAuth'
import { hasPublicBlobStore } from '@/lib/storage/blob'
import { putPublicObject, deletePublicObject } from '@/lib/storage/provider'
import { revalidatePath } from 'next/cache'
import { getBoardPostRevalidationPaths } from '@/lib/revalidationPaths'
import type { PostAttachmentStats } from '@/types'
import { validateUUID } from '@/utils/validation'
import { generateUniqueFileName } from '@/utils/fileNameSanitizer'
import {
  validateFile,
  FILE_VALIDATION_PROFILES,
  formatValidationErrors,
  hasValidFileSignature,
} from '@/utils/fileUploadValidation'
import { getPostById } from '@/db/queries/posts'
import { addAttachment, listAttachments, getAttachmentUploadStats } from '@/db/queries/attachments'

/**
 * 첨부파일 목록 조회
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resolvedParams = await context.params
  try {
    const postId = resolvedParams.id

    const uuidValidation = validateUUID(postId, '게시글 ID')
    if (!uuidValidation.isValid) {
      return ApiError.badRequest(
        uuidValidation.errors[0] || '잘못된 게시글 ID 형식입니다.'
      ).toNextResponse()
    }

    const validPostId = uuidValidation.sanitized

    // 공개 읽기 허용: 인증 없이도 첨부파일 목록을 조회할 수 있게 함
    // (쓰기/업로드는 계속 보호됨)
    //
    // 게시글 존재 확인. 단계 2c(Task 5): Supabase
    // `.eq('id', validPostId).eq('is_deleted', false)`에서 Turso 쿼리 계층
    // getPostById(validPostId, { includeDeleted: false })로 옮겼다.
    const post = await getPostById(validPostId, { includeDeleted: false }).catch(() => null)

    if (!post) {
      return ApiError.notFound('게시글을 찾을 수 없습니다.').toNextResponse()
    }

    // 첨부파일 목록 조회. 단계 2c(Task 5): Supabase
    // `.eq('post_id', validPostId).order('sort_order', ...)`에서 Turso 쿼리
    // 계층 listAttachments(validPostId)로 옮겼다(이미 sort_order 오름차순).
    let attachments
    try {
      attachments = await listAttachments(validPostId)
    } catch (attachmentsError) {
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

    // 첨부파일 업로드는 로그인만 확인한다(승인 여부는 보지 않음). 작성자
    // 소유권 확인은 아래에서 별도로 한다.
    const auth = await requireUser()
    if (auth instanceof NextResponse) return auth
    const { user } = auth

    const validPostId = uuidValidation.sanitized

    // 게시글 존재 및 권한 확인. 단계 2c(Task 5): Supabase
    // `.eq('id', validPostId)`(is_deleted 필터 없음)에서 Turso 쿼리
    // 계층 getPostById(validPostId, { includeDeleted: true })로 옮겼다 —
    // 삭제된 글에도 필터를 걸지 않던 기존 동작을 그대로 재현한다.
    let post = null
    {
      const postData = await getPostById(validPostId, { includeDeleted: true }).catch(() => null)

      if (!postData) {
        console.error('[UPLOAD API] 게시글 조회 실패: 게시글을 찾을 수 없음')
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

    // 첨부파일 제한 확인. 단계 2c(Task 5): Supabase
    // `.eq('post_id', validPostId)` 전체 조회 후 JS 합산에서 Turso 쿼리 계층
    // getAttachmentUploadStats(validPostId)(단일 집계 쿼리, count(*)/sum)로
    // 옮겼다.
    {
      let currentCount = 0
      let currentTotalSize = 0
      try {
        const stats = await getAttachmentUploadStats(validPostId)
        currentCount = stats.count
        currentTotalSize = stats.total_size
      } catch (existingError) {
        console.error('기존 첨부파일 조회 오류:', existingError)
        return ApiError.internalServerError('첨부파일 제한 확인에 실패했습니다.').toNextResponse()
      }

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

    // 업로드 전에 저장소 자격 증명을 미리 검증한다 — 실패 시 구체적이고
    // 조치 가능한 메시지로 즉시 응답한다(putPublicObject가 던지는 환경변수
    // 이름이 그대로 사용자에게 보이는 500이 되지 않게).
    if (!hasPublicBlobStore()) {
      console.error('[UPLOAD API] PUBLIC_BLOB_READ_WRITE_TOKEN 미설정')
      return ApiError.serviceUnavailable(
        'Storage 서비스를 사용할 수 없습니다. 관리자에게 문의하세요.'
      ).toNextResponse()
    }

    // 파일명 정제 및 고유 파일명 생성 (공통 검증에서 이미 생성됨)
    const uniqueFileName = validation.uniqueFileName || generateUniqueFileName(file.name)

    // 파일을 Blob 저장소에 업로드
    const fileBuffer = Buffer.from(await file.arrayBuffer())
    if (!hasValidFileSignature(fileBuffer, file.type)) {
      return ApiError.badRequest(
        '파일 내용이 선언된 파일 형식과 일치하지 않습니다.'
      ).toNextResponse()
    }

    const filePath = `posts/${validPostId}/${uniqueFileName}`

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
          'Storage가 설정되지 않았습니다. 관리자에게 문의하세요.'
        ).toNextResponse()
      }
      return ApiError.internalServerError('파일 업로드에 실패했습니다.').toNextResponse()
    }

    {
      // 기존 대표 이미지 해제는 여기서 하지 않는다 — addAttachment가 INSERT와
      // 같은 트랜잭션 안에서 함께 처리한다. 여기서 따로 부르던 시절에는 해제
      // 실패를 console.warn만 하고 넘어가 대표가 둘이 되기도 했다.
      //
      // 첨부파일 메타데이터를 데이터베이스에 저장. 단계 2c(Task 5): Supabase
      // `.insert(attachmentData).select().single()`에서 Turso 쿼리 계층
      // addAttachment(Turso)로 옮겼다 — sort_order를 명시하지 않아 자동 부여
      // 경로(트리거 재현)를 그대로 탄다.
      let attachment
      try {
        attachment = await addAttachment({
          post_id: validPostId,
          file_name: file.name,
          file_url: fileUrl,
          file_type: fileType,
          file_size: file.size,
          mime_type: file.type,
          alt_text: altText || null,
          is_primary: isPrimary && fileType === 'image',
        })
      } catch (dbError) {
        console.error('[UPLOAD API] 메타데이터 저장 실패:', dbError)

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
        // 태그 무효화는 생산자가 없어 무효했다(posts/[id]/route.ts와 동일
        // 사유). 게시글 상세·목록 경로를 직접 무효화한다.
        for (const boardPath of getBoardPostRevalidationPaths(validPostId)) {
          revalidatePath(boardPath)
        }
      } catch {}

      return ApiSuccess.ok(
        { attachment },
        '첨부파일이 성공적으로 업로드되었습니다.'
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
