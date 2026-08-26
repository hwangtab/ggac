import { NextResponse } from 'next/server'

import { getSessionContext, isApprovedActive } from '@/lib/server/authz'
import type { ProfileLike, SessionContext } from '@/lib/server/authz'
import { readSessionUser, type SessionUser } from '@/lib/server/session'

export type UserAuthSuccess = {
  user: { id: string; email?: string | null; email_confirmed_at?: string | null }
}

export type MemberAuthSuccess = {
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
 * `requireActiveMember`와 구분해서 존재한다. 두 함수의 차이는 이제 오직
 * "승인·활성까지 요구하는가"뿐이다 — 단계 4 Task 5 이전에는
 * `requireActiveMember`만 service-role Supabase 클라이언트를 함께 돌려줬지만,
 * 데이터 권위가 전부 Turso로 넘어가면서 그 클라이언트를 쓰는 호출부가 하나도
 * 남지 않아 반환값에서 뺐다.
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
 * 확인한다.
 *
 * 사용 예:
 *   const auth = await requireActiveMember()
 *   if (auth instanceof NextResponse) return auth
 *   const { user } = auth
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

  return {
    user: {
      id: session.user!.id,
      email: session.user!.email,
      email_confirmed_at: session.user!.email_confirmed_at,
    },
    profile: session.profile,
  }
}

/**
 * 로그인했으면 사용자를, 아니면 `null`을 돌려준다. **차단하지 않는다.**
 *
 * 게시판 목록·댓글 목록처럼 비로그인 방문자도 읽을 수 있어야 하는 라우트가
 * "내 좋아요 여부" 같은 개인화 데이터를 얹을 때 쓴다. 이런 곳에
 * `requireUser()`를 쓰면 비로그인 방문자가 401을 받아 게시판이 닫힌다.
 *
 * 프로필은 조회하지 않는다 — 이 경로들은 승인 여부를 따지지 않고, `/api/posts`
 * GET은 게시판 목록의 hot path라 쿼리를 하나 더 얹으면 안 된다.
 */
export async function getOptionalUser(): Promise<SessionUser | null> {
  return readSessionUser()
}
