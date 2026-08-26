/**
 * 임시 첨부파일 정리 API
 * 만료된 임시 첨부파일을 정리하는 cron job용 엔드포인트
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { timingSafeEqual } from 'crypto'
import { deletePublicObject, logicalPathFromUrl } from '@/lib/storage/provider'
import { createLogger } from '@/utils/logger'
import { deleteExpiredTempAttachments, listTemporaryAttachments } from '@/db/queries/attachments'

const log = createLogger('api/cleanup/temp-attachments')

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

    // 1+3. 만료된 임시 첨부파일을 조회하면서 동시에 DB에서 삭제한다. 단계
    // 2c(Task 5): Supabase 구현은 "SELECT(만료분) → Storage 삭제 시도 → id로
    // DELETE" 순서였다. Turso 쿼리 계층 deleteExpiredTempAttachments는 SQLite
    // `DELETE ... RETURNING`으로 조회+삭제를 원자적 단일 문으로 합친다 —
    // **무엇이 삭제되는지(is_temporary=true AND expires_at < now)는 기존과
    // 100% 동일**하지만, DB 삭제와 Storage 삭제의 순서가 바뀐다(DB가 먼저
    // 지워진 뒤 그 결과로 Storage를 지운다). 만료된 임시 첨부는 애초에
    // 24시간 TTL의 미게시 초안 파일이라 이 순서 변경의 실질적 위험은 낮다고
    // 판단했다 — 자세한 근거는 task-5-report.md 참고.
    let expiredAttachments
    try {
      expiredAttachments = await deleteExpiredTempAttachments()
    } catch (queryError) {
      console.error('[CLEANUP] 만료된 첨부파일 조회/삭제 실패:', queryError)
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

    // 2. Storage에서 파일 삭제(DB 행은 이미 지워졌다 — 위 순서 변경 참고)
    const filePaths = expiredAttachments
      .map(att => {
        const path = logicalPathFromUrl(att.file_url, 'attachments', 'temp')
        if (!path) {
          console.warn('[CLEANUP] 안전하지 않은 임시 첨부파일 URL 건너뜀:', att.id)
          return null
        }

        return path
      })
      .filter((path): path is string => path !== null)

    if (filePaths.length > 0) {
      log.debug('Deleting temporary attachment files from Storage', { count: filePaths.length })
      // filePaths의 각 항목은 logicalPathFromUrl이 돌려준, 버킷을 포함한
      // 논리 경로('attachments/temp/...')다 — deletePublicObject가 그대로
      // 기대하는 형태라 추가 접두사 없이 곧장 넘긴다. logicalPathFromUrl은
      // 아직 Supabase 형식 URL도 이해한다 — 저장된 file_url이 Blob URL로
      // 재작성되기 전 행이 남아 있어서다(그 함수 주석 참고). 개별 실패로 전체
      // 정리가 막히지 않도록 실패는 로그에만 남긴다.
      const results = await Promise.allSettled(filePaths.map(p => deletePublicObject(p)))
      for (const r of results) {
        if (r.status === 'rejected') {
          log.warn('임시 첨부 삭제 실패', { reason: String(r.reason) })
        }
      }
      log.debug('Temporary attachment Storage deletion attempted')
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

    // 임시 첨부파일 통계 조회. 단계 2c(Task 5): Supabase
    // `.eq('is_temporary', true)`에서 Turso 쿼리 계층
    // listTemporaryAttachments()로 옮겼다(만료 여부와 무관하게 임시 첨부
    // 전체를 조회 — 아래에서 그대로 now 기준으로 분류한다).
    let stats
    try {
      stats = await listTemporaryAttachments()
    } catch {
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
