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
  return (
    <div className="mx-auto max-w-4xl pb-16">
      <div className="mb-6">
        <Link
          href="/board-room"
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          ← 이사회로
        </Link>
      </div>

      <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-8">메일함</h1>

      <MailboxView />
    </div>
  )
}
