import { redirect } from '@/i18n/navigation'
import { getSessionContext, isApprovedActive } from '@/lib/server/authz'
import type { Locale } from '@/i18n/routing'

export type MarketViewer =
  | { kind: 'member'; userId: string; isAdmin: boolean }
  /** 로그인은 했지만 승인·활성 조합원이 아니다(승인 대기 등). */
  | { kind: 'not-member' }

/**
 * 장터 화면(`/board/market/*`) 진입 판정. 로그인하지 않았으면 **여기서
 * 로그인으로 보낸다**(돌아올 주소를 붙여서).
 *
 * 세션·프로필 조회가 실패하면 조합원이 아닌 것으로 본다(fail-closed) —
 * `board/write/page.tsx`와 같은 태도다. 화면 판정은 안내일 뿐이고 데이터는
 * 이 화면들이 쿼리 계층을 직접 읽으므로, **이 함수가 곧 경계다.** API 쪽
 * 경계는 `/api/market/*`의 `requireActiveMember`가 따로 지킨다.
 */
export async function resolveMarketViewer(locale: Locale, returnTo: string): Promise<MarketViewer> {
  const session = await getSessionContext()

  if (!session.authenticated || !session.user) {
    redirect({ href: { pathname: '/login', query: { redirect: returnTo } }, locale })
  }

  if (session.profileError || !isApprovedActive(session.profile)) {
    return { kind: 'not-member' }
  }

  return {
    kind: 'member',
    userId: session.user!.id,
    isAdmin: session.profile?.is_admin === true,
  }
}
