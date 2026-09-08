'use client'

import { Link } from '@/i18n/navigation'
import MailboxView from '../../admin/mailbox/MailboxView'

/**
 * 이사회 메일함 — 브리프 D.
 *
 * 미들웨어가 `/admin`을 관리자에게만 열어서 이사·감사는 `/admin/mailbox`에
 * 못 들어간다. 그래서 같은 본체(`MailboxView`)를 이사회 영역에도 둔다.
 * API(`/api/admin/mailbox*`)는 이제 `board-member` 게이트라 이사·감사도
 * 통과하고, 답장·상태 변경은 API가 주는 `can_manage`(관리자 여부)로 화면이
 * 알아서 가린다.
 */
export default function BoardRoomMailboxPage() {
  // 2단 구조(목록+상세)는 max-w-4xl 안에서는 상세 칸이 좁아 iframe이
  // 실질적으로 늘어나지 않는다 — 이사회 레이아웃의 다른 페이지는 폭 제약이
  // 필요 없는 문서·안건 목록이라 4xl로 충분했지만, 메일함은 상세 칸에 화면
  // 폭 대부분이 필요하다.
  return (
    <div className="pb-16">
      <div className="mb-6">
        <Link
          href="/board-room"
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          ← 이사회로
        </Link>
      </div>

      <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-8">메일함</h1>

      {/*
        높이는 실측(getBoundingClientRect, e2e 임시 계측)으로 잡았다: 이 칸
        위쪽 크롬(pt-16 md:pt-20 + container py-6 md:py-8 + 위 링크·h1)이
        데스크톱 1280px에서 228px, 좁은 화면 390px에서 264px다. 16rem(256px)은
        그 중간값이다.

        **admin과 달리 board-room은 이 calc만으로 페이지 스크롤을 0으로
        만들 수 없다.** `ConditionalLayout`이 `/admin`이 아닌 모든 경로에
        전역 `<Footer>`를 붙이는데, 그 높이가 데스크톱 429px·좁은 화면
        810px(다단 링크가 세로로 쌓인다)다. 위 크롬(228~264px) + 이 div의
        `pb-16`(64px) + Footer만 더해도 데스크톱 720px 뷰포트 기준 753px,
        좁은 화면 844px 뷰포트 기준 1162px로 **`MailboxView` 높이가 0이어도
        이미 뷰포트를 넘는다** — Footer를 감추거나 레이아웃을 바꾸지 않는 한
        이 페이지의 페이지 레벨 스크롤은 구조적으로 없앨 수 없다(다른
        board-room 페이지도 전부 같은 이유로 스크롤한다 — 이번 변경이 만든
        문제가 아니다). 그래서 여기서는 calc를 억지로 줄여 상세 칸을
        쥐어짜는 대신, 위쪽 크롬만 상쇄하는 값을 써서 `MailboxView`가 실제로
        쓸 수 있는 세로를 최대로 준다 — 어차피 스크롤이 없어지지 않는다면
        칸을 작게 만들 이유가 없다.
      */}
      <MailboxView className="h-[calc(100vh-16rem)] min-h-[420px]" />
    </div>
  )
}
