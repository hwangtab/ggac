import { createSupabaseServer } from '@/lib/supabase/server'

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
 * **Supabase 인증에 닿는 유일한 지점이다.**
 *
 * 단계 2b-5에서 Better Auth로 전환할 때 바꾸는 파일은 여기 하나다. 그래서
 * 이 함수에는 신원 판독 외의 로직을 넣지 않는다 — 프로필 조회도(그건
 * `getSessionContext()`의 몫이다), 권한 판정도(그건 `memberAuth`의 몫이다)
 * 아니다.
 *
 * 세션이 없거나 검증에 실패하면 예외를 던지지 않고 `null`을 돌려준다.
 * 호출부가 "로그인 안 함"과 "오류"를 구분할 필요가 없기 때문이다 — 두 경우
 * 모두 익명으로 취급하는 것이 기존 동작이었고, 이 단계는 동작을 바꾸지 않는다.
 */
export async function readSessionUser(): Promise<SessionUser | null> {
  const supabase = await createSupabaseServer()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) return null

  return {
    id: user.id,
    email: user.email,
    email_confirmed_at: user.email_confirmed_at,
  }
}
