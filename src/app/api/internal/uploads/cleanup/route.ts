/**
 * 참조되지 않은 에디터 업로드 정리 (크론 전용).
 *
 * `/api/media/upload`는 Blob에 파일을 올리고 원장(`media_uploads`)에 기록만
 * 한다. 에디터에 삽입된 파일은 게시글 본문에 URL이 박히지만, 올려 놓고 쓰지
 * 않은 파일은 아무 데서도 참조되지 않는다. 이 크론이 그 파일들을 지운다.
 *
 * 판정은 쿼리 계층(`listCleanupCandidates`)에 있다 — 여기는 **배선만** 한다.
 * 그래야 "무엇을 지워도 되는가"를 네트워크 없이 테스트할 수 있다.
 *
 * 인증은 조합비 청구 크론(`/api/internal/dues/charge`)과 같은 방식 — 공유
 * 토큰을 타이밍 안전 비교하고, 토큰이 설정돼 있지 않으면 **닫는다**(fail-closed).
 * 받는 토큰이 둘인 이유는 `isAuthorized` 주석에 있다.
 */

import { NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'

import {
  listCleanupCandidates,
  deleteUpload,
  CLEANUP_BATCH_LIMIT,
  CLEANUP_AGE_MS,
} from '@/db/queries/uploads'
import { deletePublicObject, logicalPathFromUrl } from '@/lib/storage/provider'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'

const log = createLogger('api/internal/uploads/cleanup')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** 한 번에 최대 100건 × 건당 Blob 왕복. 넉넉히 잡아 둔다. */
export const maxDuration = 300

function isAuthorized(request: NextRequest): boolean {
  // 받아들이는 토큰 둘.
  //
  // - `CLEANUP_CRON_TOKEN` — 임시 첨부 정리와 같은 정리 크론 공용 토큰. 이미
  //   운영에 발급돼 있어(`scripts/verify-env.js`) 손으로 호출할 때 쓴다.
  // - `CRON_SECRET` — **Vercel 크론이 실제로 보내는 값**이다. Vercel은
  //   `Authorization: Bearer $CRON_SECRET`을 고정으로 붙이고 헤더를 바꿀 수단이
  //   없다. 이걸 받지 않으면 vercel.json에 등록한 크론이 매일 401만 받는다.
  //
  // 어느 쪽도 설정돼 있지 않으면 **닫는다**(fail-closed) — 토큰 없는 배포에서
  // 이 라우트가 공개 삭제 엔드포인트가 되면 안 된다.
  const expected = [process.env.CLEANUP_CRON_TOKEN, process.env.CRON_SECRET].filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  )
  if (expected.length === 0) return false

  const header = request.headers.get('authorization') ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''

  // 길이 선검사 — timingSafeEqual은 길이가 다르면 던진다.
  return expected.some(
    token =>
      provided.length === token.length && timingSafeEqual(Buffer.from(provided), Buffer.from(token))
  )
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return ApiError.unauthorized('인증이 필요합니다.').toNextResponse()
    }

    const candidates = await listCleanupCandidates({
      ageMs: CLEANUP_AGE_MS,
      limit: CLEANUP_BATCH_LIMIT,
    })

    let deleted = 0
    let failed = 0

    for (const row of candidates) {
      const url = String(row.url ?? '')
      const bucket = String(row.bucket ?? '')
      // 우리 Blob 저장소의 URL이 맞는지 확인한 뒤에만 지운다 — 원장에 이상한
      // 값이 들어와도 남의 객체를 지우려 시도하지 않게 하는 봉쇄다.
      const logical = logicalPathFromUrl(url, bucket)
      if (!logical) {
        failed++
        log.error('안전하지 않은 url이라 삭제를 건너뜀', { id: row.id, url })
        continue
      }

      try {
        await deletePublicObject(logical)
      } catch (error) {
        // 행을 남긴다 — 다음 실행이 같은 후보를 다시 집어 재시도한다.
        // 여기서 행부터 지우면 Blob에만 파일이 남는 고아가 되고, 그건 이
        // 크론이 없애려던 바로 그 상태다.
        failed++
        log.error('Blob 삭제 실패(다음 실행에 재시도)', { id: row.id, url, error })
        continue
      }

      await deleteUpload(String(row.id))
      deleted++
    }

    return ApiSuccess.ok({
      scanned: candidates.length,
      deleted,
      failed,
    }).toNextResponse()
  } catch (error) {
    log.error('업로드 정리 실패', error)
    return ApiError.internalServerError('정리에 실패했습니다.').toNextResponse()
  }
}
