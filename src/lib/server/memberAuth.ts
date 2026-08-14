import { NextResponse } from 'next/server'

import { getSessionContext, isApprovedActive } from '@/lib/server/authz'
import type { ProfileLike, SessionContext } from '@/lib/server/authz'
import { createServiceRoleClient, type ServiceRoleSupabaseClient } from '@/lib/server/supabaseAdmin'
import { createLogger } from '@/utils/logger'

const log = createLogger('memberAuth')

export type UserAuthSuccess = {
  user: { id: string; email?: string | null; email_confirmed_at?: string | null }
}

export type MemberAuthSuccess = {
  db: ServiceRoleSupabaseClient
  user: { id: string; email?: string | null; email_confirmed_at?: string | null }
  profile: ProfileLike | null
}

/**
 * `requireUser`가 내려야 할 응답을 판정한다. 부수효과가 없어 단위 테스트로
 * 분기를 전수 고정할 수 있도록 분리했다.
 */
export function classifySessionForUser(session: SessionContext): 'ok' | 'unauthenticated' {
  if (!session.authenticated || !session.user) return 'unauthenticated'
  return 'ok'
}

/**
 * `requireActiveMember`가 내려야 할 응답을 판정한다.
 *
 * 순서가 의미를 갖는다: 미인증(401) → 프로필 조회 실패(500) → 미승인/비활성(403).
 * 기존 라우트들이 인라인으로 하던 검사와 같은 순서·같은 구분이며, 이 단계는
 * 동작을 바꾸지 않는 것이 목표이므로 순서를 임의로 바꾸지 않는다.
 */
export function classifySessionForMember(
  session: SessionContext
): 'ok' | 'unauthenticated' | 'profile-error' | 'not-approved' {
  if (!session.authenticated || !session.user) return 'unauthenticated'
  if (session.profileError || !session.profile) return 'profile-error'
  if (!isApprovedActive(session.profile)) return 'not-approved'
  return 'ok'
}

/**
 * 로그인만 확인한다. 조합원 승인 여부는 보지 않는다.
 *
 * 가입 직후 승인 대기 중인 사용자도 자기 프로필을 읽고 고쳐야 하므로,
 * `requireActiveMember`와 구분해서 존재한다. service-role 클라이언트를 주지
 * 않는 것도 같은 이유다 — 승인되지 않은 사용자에게 RLS를 우회하는 클라이언트를
 * 쥐여줄 근거가 없다. 필요한 라우트는 `createSupabaseServer()`를 직접 부른다.
 */
export async function requireUser(): Promise<UserAuthSuccess | NextResponse> {
  const session = await getSessionContext()

  if (classifySessionForUser(session) === 'unauthenticated') {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  }

  return {
    user: {
      id: session.user!.id,
      email: session.user!.email,
      email_confirmed_at: session.user!.email_confirmed_at,
    },
  }
}

/**
 * 로그인 + 조합원 승인(`registration_status='approved'`, `is_active=true`)을
 * 확인하고 service-role 클라이언트를 함께 돌려준다.
 *
 * 사용 예:
 *   const auth = await requireActiveMember()
 *   if (auth instanceof NextResponse) return auth
 *   const { db, user } = auth
 */
export async function requireActiveMember(): Promise<MemberAuthSuccess | NextResponse> {
  const session = await getSessionContext()
  const verdict = classifySessionForMember(session)

  if (verdict === 'unauthenticated') {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  }
  if (verdict === 'profile-error') {
    return NextResponse.json({ error: '프로필 정보를 조회할 수 없습니다.' }, { status: 500 })
  }
  if (verdict === 'not-approved') {
    return NextResponse.json({ error: '승인된 조합원만 이용할 수 있습니다.' }, { status: 403 })
  }

  let db: ServiceRoleSupabaseClient
  try {
    db = createServiceRoleClient()
  } catch {
    log.error('SUPABASE_SERVICE_ROLE_KEY 또는 NEXT_PUBLIC_SUPABASE_URL 미설정')
    return NextResponse.json({ error: '서버 구성 오류입니다.' }, { status: 500 })
  }

  return {
    db,
    user: {
      id: session.user!.id,
      email: session.user!.email,
      email_confirmed_at: session.user!.email_confirmed_at,
    },
    profile: session.profile,
  }
}
