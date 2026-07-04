/**
 * 무인증 헬스체크 엔드포인트
 *
 * 배포 후 스모크 체크·외부 모니터링용. 항상 200으로 응답한다.
 * - status: 'ok' (정상) | 'degraded' (db 핑 실패)
 * - db: 'ok' | 'error'
 * - commit: 배포 커밋 SHA (Vercel 환경변수, 없으면 'unknown')
 *
 * 인증·rate limit 없음. 미들웨어는 /api/* 를 조기 통과시키므로 보호되지 않는다.
 */

import { createSupabaseServer } from '@/lib/supabase/server'
import { ApiSuccess } from '@/utils/apiWrapper'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  let db: 'ok' | 'error' = 'ok'

  try {
    const supabase = await createSupabaseServer()
    // 가벼운 핑: 공개 posts 테이블에서 1행만 조회 (데이터는 사용하지 않음)
    const { error } = await supabase.from('posts').select('id').limit(1)
    if (error) {
      db = 'error'
    }
  } catch {
    db = 'error'
  }

  const status = db === 'ok' ? 'ok' : 'degraded'
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? 'unknown'

  // 헬스체크는 db 실패 시에도 200으로 응답해야 한다.
  return ApiSuccess.ok({ status, db, commit }).toNextResponse()
}
