import { headers } from 'next/headers'

import { auth } from '@/lib/auth/server'

/**
 * 요청의 세션 사용자.
 * `authz.ts`가 쓰던 SessionUser와 같은 형태다 — 두 곳에서 따로 정의하면
 * 단계 2b-5에서 한쪽만 고치는 사고가 난다.
 */
export interface SessionUser {
  id: string
  email?: string | null
  email_confirmed_at?: string | null
}

/**
 * **Better Auth 인증에 닿는 유일한 지점이다.**
 *
 * 단계 2b-6에서 Supabase Auth를 걷어낼 때 바꾸는 파일은 여기 하나다. 그래서
 * 이 함수에는 신원 판독 외의 로직을 넣지 않는다 — 프로필 조회도(그건
 * `getSessionContext()`의 몫이다), 권한 판정도(그건 `memberAuth`의 몫이다)
 * 아니다.
 *
 * 세션이 없거나 검증에 실패하면 예외를 던지지 않고 `null`을 돌려준다.
 * 호출부가 "로그인 안 함"과 "오류"를 구분할 필요가 없기 때문이다 — 두 경우
 * 모두 익명으로 취급하는 것이 기존 동작이었고, 이 단계는 동작을 바꾸지 않는다.
 * (Better Auth의 세션 조회는 세션이 없으면 그냥 `null`을 돌려주지만, DB 장애
 * 같은 예외적인 실패는 던질 수 있으므로 여기서 잡아 같은 계약을 유지한다.)
 */
export async function readSessionUser(): Promise<SessionUser | null> {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session?.user) return null

    return {
      id: session.user.id,
      email: session.user.email,
      // 소비자는 "값이 있으면 확인된 계정"으로 읽는다(verify-session 라우트 참고).
      // Better Auth는 boolean만 주므로, 참일 때만 값을 넣어 그 의미를 보존한다.
      // 정확한 확인 시각은 Better Auth가 노출하지 않는다. 실측(2026-08-20):
      // 소비자 5곳이 전부 `!!`로 존재 여부만 본다 — 시각 값을 읽거나 비교하는
      // 곳은 없다(register/pending/page.tsx:34,58,60 · login/page.tsx:215 ·
      // api/auth/verify-session/route.ts:42,53). 그러므로 참일 때만 값을 넣는
      // 방식이 안전하다.
      email_confirmed_at: session.user.emailVerified ? new Date().toISOString() : null,
    }
  } catch {
    return null
  }
}
