/**
 * 무인증 헬스체크 엔드포인트
 *
 * 배포 후 스모크 체크·외부 모니터링용. 항상 200으로 응답한다.
 * - status: 'ok' (전부 정상) | 'degraded' (하나 이상 핑 실패)
 * - db: 'ok' | 'error' — Turso/Supabase 중 하나라도 실패하면 'error'
 *   (스모크 체크(scripts/utils/deployment/smoke-check.mjs)가 이 필드만 보므로
 *   레거시 호환을 위해 남긴다).
 * - turso: 'ok' | 'error' — Turso 연결 확인(Task 8). posts는 단계 3c부터
 *   Turso가 권위이므로, 컷오버 후 헬스체크가 실제로 의미를 가지려면 이 확인이
 *   필수다 — Supabase만 확인하면 Turso 연결이 끊겨도 헬스체크가 계속 'ok'를
 *   낸다.
 * - supabase: 'ok' | 'error' — Supabase 연결 확인. 단계 4 대상 표
 *   (user_activities 등)가 아직 Supabase에 남아 있어 계속 확인한다.
 * - commit: 배포 커밋 SHA (Vercel 환경변수, 없으면 'unknown')
 *
 * 인증·rate limit 없음. 미들웨어는 /api/* 를 조기 통과시키므로 보호되지 않는다.
 */

import { sql } from 'drizzle-orm'
import { db as tursoDb } from '@/db/client'
import { createSupabaseServer } from '@/lib/supabase/server'
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

async function pingSupabase(): Promise<'ok' | 'error'> {
  try {
    const supabase = await createSupabaseServer()
    // 가벼운 핑: 공개 posts 테이블에서 1행만 조회 (데이터는 사용하지 않음)
    const { error } = await supabase.from('posts').select('id').limit(1)
    return error ? 'error' : 'ok'
  } catch {
    return 'error'
  }
}

export async function GET() {
  const [turso, supabase] = await Promise.all([pingTurso(), pingSupabase()])

  const db: 'ok' | 'error' = turso === 'ok' && supabase === 'ok' ? 'ok' : 'error'
  const status = db === 'ok' ? 'ok' : 'degraded'
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? 'unknown'

  // 헬스체크는 db 실패 시에도 200으로 응답해야 한다.
  return ApiSuccess.ok({ status, db, turso, supabase, commit }).toNextResponse()
}
