import { redirect } from '@/i18n/navigation'
import type { Locale } from '@/i18n/routing'
import { canAccessBoardRoom, getSessionContext } from '@/lib/server/authz'

/**
 * 이사회 **전용 화면**(일정 투표·메일함)의 서버측 게이트.
 *
 * 왜 필요한가: 두 화면은 `'use client'`라 서버 인가가 전혀 없었고, 경계가
 * `src/middleware/auth.ts`의 경로 문자열 **한 겹**뿐이었다. 지금은 데이터가
 * 전부 API에서 막혀 실익이 없지만, 이 화면에 서버 조회가 붙는 순간 그
 * 문자열 하나가 유일한 방어가 된다 — 미들웨어의 `isBoardRoomRecordPage`
 * 예외 목록은 이번 회차에만 두 번 바뀐 자리다.
 *
 * API의 `requireBoardMember`와 **같은 기준**(`canAccessBoardRoom`)을 쓰되,
 * 반환값이 아니라 `redirect`를 던진다 — 페이지에는 응답을 돌려줄 호출부가
 * 없다. 판정 함수를 공유하므로 한쪽만 느슨해지는 표류가 생기지 않는다.
 *
 * 목적지는 미들웨어와 맞춘다: 미인증은 로그인으로(돌아올 곳을 들려서),
 * 권한 부족은 `/board`로. 미승인·비활성 계정을 `/register/pending`으로
 * 보내는 미들웨어의 앞선 분기까지 따라 하지는 않는다 — 그 분기는 이
 * 게이트보다 먼저 걸리므로 여기 도달하지 않고, 도달한다면 그것 자체가
 * 미들웨어가 무력화된 상태라 `/board`로 내보내는 편이 안전하다.
 *
 * @param locale 현재 로케일. `redirect`가 접두어를 붙이는 데 쓴다.
 * @param returnTo 로그인 후 돌아올 경로.
 */
export async function requireBoardMemberPage(locale: Locale, returnTo: string): Promise<void> {
  const session = await getSessionContext()

  if (!session.authenticated || !session.user) {
    redirect({
      href: { pathname: '/login', query: { redirect: returnTo } },
      locale,
    })
  }

  if (!canAccessBoardRoom(session.profile)) {
    redirect({ href: '/board', locale })
  }
}
