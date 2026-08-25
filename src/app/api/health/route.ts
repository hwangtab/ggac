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
 * - supabase: 'ok' | 'error' — Supabase 연결 확인. 단계 4(Task 4)에서
 *   `system_settings`을 포함한 설정·이사회·아티스트·기타 표의 권위가
 *   Turso로 옮겨갔고, 같은 라운드의 회귀 수정으로 `src/middleware/
 *   settings.ts`도 더 이상 Supabase를 읽지 않는다(이전엔 미들웨어의
 *   유지보수 모드 판정이 이 표의 Supabase 사본에 의존해서 그 표를 핑
 *   대상으로 골랐지만, 그 의존이 없어졌다 — `src/middleware/
 *   supabase-rest.ts`는 이제 아무도 참조하지 않는다, 삭제는 Task 5 몫).
 *   이제 이 핑은 순수하게 "Supabase 프로젝트 자체가 아직 살아있는가"만
 *   확인한다 — Task 5가 `createSupabaseServer()`를 완전히 걷어내기 전까지
 *   남아있는 다른 Supabase 경로들의 대리 신호로 쓴다. `posts`는 컷오버 후
 *   Supabase에서 지워질 1순위 후보라(코드리뷰 지적) 그 표를 계속 핑하면
 *   삭제되는 순간 이 헬스체크가 이유 없이 degraded로 뒤집힌다 —
 *   `system_settings`은 당장 지워질 계획이 없는 표라 더 안정적인 핑
 *   대상이다.
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
