import type { Metadata } from 'next'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { listStaffDirectory } from '@work/lib/channels/queries'
import { filterVisiblePeople, guestVisibleUserIds } from '@work/lib/staff/visibility'
import { PageBody, PageHeader } from '@work/components/layout/page'
import ChatHome from '@work/components/chat/ChatHome'
import NewChatPicker from '@work/components/chat/NewChatPicker'

export const metadata: Metadata = { title: '채팅' }

/**
 * /board-room/chat — 원본 `app/(app)/chat/page.tsx`. 데스크톱은 빈 상태, 모바일은 DM 목록 전체 화면.
 * `?new=1` 이면 새 채팅(사람 고르기).
 *
 * ggac 이식: 업무 첫 화면(이사회실 메뉴 '업무' 묶음의 "대화"가 오는 곳)을 겸해서, 넓은 화면 빈 상태의 제목을
 * "대화"로 두고 누구로 들어왔는지(이름·직함·역할)를 함께 보인다(권한 E2E가 이 줄로 가드 결과를 본다).
 * 좁은 화면(lg 미만)에서는 셸이 이 본문 대신 대화 목록(채널·메시지)을 보인다.
 */
export default async function BoardWorkChatPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const wantsNew = (await searchParams)?.new === '1'
  const ctx = await requireWorkStaff()
  const { user, staff } = ctx
  if (!wantsNew) {
    return (
      <ChatHome
        title="대화"
        description={
          <>
            <span className="block" data-testid="board-work-staff">
              {staff.display_name}
              {staff.title ? ` · ${staff.title}` : ''} ·{' '}
              {staff.role === 'admin' ? '관리자' : '구성원'}
            </span>
            <span className="mt-1 block">
              목록에서 대화를 고르거나 새 채팅으로 이사·감사에게 말을 걸어 보세요.
            </span>
          </>
        }
      />
    )
  }

  const [people, visible] = await Promise.all([
    listStaffDirectory(ctx),
    guestVisibleUserIds(ctx, staff),
  ])
  return (
    <>
      <PageHeader title="새 채팅" hideOnMobile />
      <PageBody>
        <NewChatPicker
          people={filterVisiblePeople(people, visible, p => p.user_id)}
          meId={user.id}
        />
      </PageBody>
    </>
  )
}
