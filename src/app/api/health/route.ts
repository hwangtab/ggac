/**
 * 무인증 헬스체크 엔드포인트
 *
 * 배포 후 스모크 체크·외부 모니터링용. 항상 200으로 응답한다.
 * - status: 'ok' (전부 정상) | 'degraded' (하나 이상 핑 실패)
 * - db: 'ok' | 'error' — Turso/Supabase 중 하나라도 실패하면 'error' (레거시
 *   호환 필드로 남긴다; 스모크 체크(scripts/utils/deployment/smoke-check.mjs:65)는
 *   실제로는 `data.status`만 본다 — 이전 주석이 "이 필드만 본다"고 잘못
 *   적었던 것을 코드리뷰 지적으로 바로잡았다).
 * - turso: 'ok' | 'error' — Turso 연결 확인(Task 8). posts는 단계 3c부터
 *   Turso가 권위이므로, 컷오버 후 헬스체크가 실제로 의미를 가지려면 이 확인이
 *   필수다 — Supabase만 확인하면 Turso 연결이 끊겨도 헬스체크가 계속 'ok'를
 *   낸다.
 * - supabase: 'ok' | 'error' — Supabase 연결 확인. 단계 4에서 활동로그·세션
 *   (user_activities 등)은 Turso로 넘어갔지만, 설정·이사회·아티스트 등
 *   Task 4 대상 표는 아직 Supabase가 권위라 계속 확인한다. 핑 대상은
 *   `system_settings`다 — `posts`는 컷오버 후 Supabase에서 지워질 1순위
 *   후보라(코드리뷰 지적) 그 표를 계속 핑하면 삭제되는 순간 이 헬스체크가
 *   이유 없이 degraded로 뒤집힌다. `system_settings`는 미들웨어의 유지보수
 *   모드 판정이 계속 의존하므로(단계 4 이후로도 안 지워질 표) 더 안정적인
 *   핑 대상이다.
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
    // 가벼운 핑: system_settings에서 1행만 조회(데이터는 사용하지 않음).
    // posts가 아니라 이 표를 고른 이유는 위 모듈 설명 참고.
    const { error } = await supabase.from('system_settings').select('id').limit(1)
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
