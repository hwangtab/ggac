/**
 * 임시 첨부파일 정리 API
 * 만료된 임시 첨부파일을 정리하는 cron job용 엔드포인트
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createServiceRoleClient } from '@/lib/server/supabaseAdmin'
import { timingSafeEqual } from 'crypto'
import { getProjectStorageObjectPath } from '@/utils/storageUrlValidation'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/cleanup/temp-attachments')

// Service Role 클라이언트 (RLS 우회 가능)
function getSupabaseAdmin() {
  return createServiceRoleClient()
}

/**
 * 임시 첨부파일 정리 실행
 */
export async function POST(request: NextRequest) {
  try {
    // 간단한 인증 (cron job용)
    const authHeader = request.headers.get('authorization')
    const expectedToken = process.env.CLEANUP_CRON_TOKEN

    if (!expectedToken || !authHeader) {
      return ApiError.unauthorized('Unauthorized').toNextResponse()
    }

    // 타이밍 공격 방지를 위한 상수 시간 비교
    const providedBuf = Buffer.from(authHeader)
    const expectedBuf = Buffer.from(`Bearer ${expectedToken}`)
    const isValid =
      providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf)
    if (!isValid) {
      return ApiError.unauthorized('Unauthorized').toNextResponse()
    }

    log.debug('Temporary attachment cleanup started')

    const supabaseAdmin = getSupabaseAdmin()

    // 1. 만료된 임시 첨부파일 조회
    const { data: expiredAttachments, error: queryError } = await supabaseAdmin
      .from('post_attachments')
      .select('id, file_url, file_name')
      .eq('is_temporary', true)
      .lt('expires_at', new Date().toISOString())

    if (queryError) {
      console.error('[CLEANUP] 만료된 첨부파일 조회 실패:', queryError)
      return ApiError.internalServerError('Failed to query expired attachments').toNextResponse()
    }

    if (!expiredAttachments || expiredAttachments.length === 0) {
      log.debug('No expired temporary attachments to clean up')
      return ApiSuccess.ok({
        message: 'No expired temporary attachments to clean up',
        cleaned: 0,
      }).toNextResponse()
    }

    log.debug('Expired temporary attachments found', { count: expiredAttachments.length })

    // 2. Storage에서 파일 삭제
    const filePaths = expiredAttachments
      .map(att => {
        const path = getProjectStorageObjectPath(att.file_url, 'attachments', 'temp')
        if (!path) {
          console.warn('[CLEANUP] 안전하지 않은 임시 첨부파일 URL 건너뜀:', att.id)
          return null
        }

        return path
      })
      .filter((path): path is string => path !== null)

    if (filePaths.length > 0) {
      log.debug('Deleting temporary attachment files from Storage', { count: filePaths.length })
      const { error: storageError } = await supabaseAdmin.storage
        .from('attachments')
        .remove(filePaths)

      if (storageError) {
        console.error('[CLEANUP] Storage 파일 삭제 실패:', storageError)
        // 스토리지 삭제 실패해도 계속 진행 (DB 정리는 수행)
      } else {
        log.debug('Temporary attachment Storage deletion completed')
      }
    }

    // 3. 데이터베이스에서 레코드 삭제
    const expiredIds = expiredAttachments.map(att => att.id)
    const { error: deleteError } = await supabaseAdmin
      .from('post_attachments')
      .delete()
      .in('id', expiredIds)

    if (deleteError) {
      console.error('[CLEANUP] DB 레코드 삭제 실패:', deleteError)
      return ApiError.internalServerError(
        'Failed to delete expired attachment records'
      ).toNextResponse()
    }

    log.debug('Temporary attachment cleanup completed', { count: expiredAttachments.length })

    // 4. 통계 반환
    return ApiSuccess.ok({
      message: 'Temporary attachments cleanup completed',
      cleaned: expiredAttachments.length,
      files: expiredAttachments.map(att => ({
        id: att.id,
        fileName: att.file_name,
      })),
    }).toNextResponse()
  } catch (error) {
    console.error('[CLEANUP] 임시 첨부파일 정리 중 오류 발생:', error)
    return ApiError.internalServerError('Internal server error during cleanup').toNextResponse()
  }
}

/**
 * 정리 상태 조회
 */
export async function GET(request: NextRequest) {
  try {
    // 간단한 인증
    const authHeader = request.headers.get('authorization')
    const expectedToken = process.env.CLEANUP_CRON_TOKEN

    if (!expectedToken || !authHeader) {
      return ApiError.unauthorized('Unauthorized').toNextResponse()
    }

    // 타이밍 공격 방지를 위한 상수 시간 비교
    const providedBuf = Buffer.from(authHeader)
    const expectedBuf = Buffer.from(`Bearer ${expectedToken}`)
    const isValid =
      providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf)
    if (!isValid) {
      return ApiError.unauthorized('Unauthorized').toNextResponse()
    }

    const supabaseAdmin = getSupabaseAdmin()

    // 임시 첨부파일 통계 조회
    const { data: stats, error } = await supabaseAdmin
      .from('post_attachments')
      .select('expires_at, file_size')
      .eq('is_temporary', true)

    if (error) {
      return ApiError.internalServerError('Failed to get stats').toNextResponse()
    }

    const now = new Date()
    const expired = stats?.filter(s => new Date(s.expires_at) < now) || []
    const active = stats?.filter(s => new Date(s.expires_at) >= now) || []

    const totalSize = stats?.reduce((sum, s) => sum + s.file_size, 0) || 0
    const expiredSize = expired.reduce((sum, s) => sum + s.file_size, 0)

    return ApiSuccess.ok({
      total: stats?.length || 0,
      active: active.length,
      expired: expired.length,
      totalSize,
      expiredSize,
      expiredSizeMB: Math.round((expiredSize / 1024 / 1024) * 100) / 100,
    }).toNextResponse()
  } catch (error) {
    console.error('[CLEANUP] 통계 조회 중 오류:', error)
    return ApiError.internalServerError('Internal server error').toNextResponse()
  }
}
