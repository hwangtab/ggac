/**
 * 무인증 헬스체크 엔드포인트
 *
 * 배포 후 스모크 체크·외부 모니터링용. 항상 200으로 응답한다.
 * - status: 'ok' (전부 정상) | 'degraded' (하나 이상 핑 실패)
 * - db: 'ok' | 'error' — 레거시 호환 필드. 지금은 turso와 같은 값이다
 *   (스모크 체크(scripts/utils/deployment/smoke-check.mjs)는 실제로는
 *   `data.status`만 보고, `data.db`는 로그 문자열에만 쓴다).
 * - turso: 'ok' | 'error' — Turso 연결 확인. 단계 4 Task 5에서 Supabase
 *   클라이언트가 저장소에서 완전히 사라지면서 `supabase` 핑도 함께 없앴다 —
 *   더 이상 어떤 코드 경로도 Supabase를 거치지 않으므로, 그 프로젝트가
 *   살아있는지는 이 앱의 건강과 무관하다. 남겨두면 컷오버 뒤 Supabase를
 *   해지하는 순간 헬스체크가 이유 없이 degraded로 뒤집히고, 스모크 체크가
 *   배포마다 실패한다.
 * - commit: 배포 커밋 SHA (Vercel 환경변수, 없으면 'unknown')
 *
 * 인증·rate limit 없음. 미들웨어는 /api/health를 유지보수 모드에서도
 * 통과시킨다.
 */

import { sql } from 'drizzle-orm'
import { db as tursoDb } from '@/db/client'
import { ApiSuccess } from '@/utils/apiWrapper'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function pingTurso(): Promise<'ok' | 'error'> {
  try {
    // 가벼운 핑 — 실제 테이블을 읽지 않고 상수 SELECT로 연결만 확인한다.
    await tursoDb.run(sql`select 1`)
    return 'ok'
  } catch {
    return 'error'
  }
}

export async function GET() {
  const turso = await pingTurso()

  const db: 'ok' | 'error' = turso
  const status = db === 'ok' ? 'ok' : 'degraded'
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? 'unknown'

  // 헬스체크는 db 실패 시에도 200으로 응답해야 한다.
  return ApiSuccess.ok({ status, db, turso, commit }).toNextResponse()
}
