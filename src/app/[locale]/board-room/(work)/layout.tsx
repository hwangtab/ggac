import type { Metadata } from 'next'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import '@work/styles.css'

/**
 * 이사회 업무툴 앱 셸 자리 — docs/board-work/01-설계.md §2-1.
 * 0단계는 가드·토큰·UI 키트가 도는지만 확인하는 빈 셸이다. 1단계에서 원본 `AppShell`(레일·사이드바·우측 패널)로 바꾼다.
 *
 * 전역 내비·푸터·포스터 테마는 `ConditionalLayout`이, 이사회실 좌측 메뉴는 `board-room/layout.tsx`가
 * `isBoardWorkPath`로 비켜 준다. 여기서 화면 전체를 쓴다.
 */
/**
 * **반드시 동적 렌더링.** 가드가 세션 쿠키를 읽지만, `readSessionUser`가 예외를 전부 삼키므로 정적 생성 중
 * Next가 던지는 "요청 데이터 필요" 신호도 삼켜진다 — 그러면 빌드 때 세션 없음으로 판정해 로그인 리다이렉트가
 * **정적 HTML로 구워진다**(실측 2026-10-29: 이 줄 없이 `/board-room/chat`이 SSG ●로 빌드됐다).
 * 하위 모든 업무툴 페이지에 적용된다. assert-runtime-risks.mjs가 이 선언을 못박는다.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '업무툴 | 이사회',
  robots: { index: false, follow: false },
}

export default async function BoardWorkLayout({ children }: { children: React.ReactNode }) {
  // 미들웨어가 먼저 막지만(이사·감사·관리자만), 서버에서 한 번 더 판정한다.
  await requireWorkStaff()

  return (
    <div data-work-app className="flex h-dvh min-h-0 flex-col font-sans">
      {children}
    </div>
  )
}
