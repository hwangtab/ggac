import { resolveMarketViewer } from '@/lib/server/marketPage'
import { isMemberDocumentsEnabled } from '@/lib/memberDocuments/settings'
import type { Locale } from '@/i18n/routing'

export type MemberDocumentsViewer =
  | { kind: 'member'; userId: string }
  /** 로그인은 했지만 승인·활성 조합원이 아니다(승인 대기·정지 등) */
  | { kind: 'not-member' }
  /** 기능 스위치가 꺼져 있다 — 화면은 "준비 중" */
  | { kind: 'off' }

/**
 * 내 문서함 화면(`/mypage/documents/*`) 진입 판정 — docs/board-work/04-조합원-문서함.md §4. 비로그인은 여기서 로그인으로
 * 보낸다(`resolveMarketViewer` — 세션·프로필 조회 실패는 조합원 아님으로 본다). 순서는 API와 같다: 조합원 → 스위치.
 * 화면은 쿼리 계층을 직접 읽으므로(`ownerId = userId`) **이 함수가 곧 화면의 경계다.**
 */
export async function resolveMemberDocumentsViewer(
  locale: Locale,
  returnTo: string
): Promise<MemberDocumentsViewer> {
  const viewer = await resolveMarketViewer(locale, returnTo)
  if (viewer.kind !== 'member') return { kind: 'not-member' }
  if (!(await isMemberDocumentsEnabled())) return { kind: 'off' }
  return { kind: 'member', userId: viewer.userId }
}
