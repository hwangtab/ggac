import type { Metadata } from 'next'
import { requireWorkStaff } from '@/lib/server/boardWorkAuth'
import { isWorkAdminRole } from '@work/lib/auth/staff'
import { ensureWorkspaceEntry } from '@work/lib/channels/bootstrap'
import {
  listChannelCategories,
  listSidebarChannels,
  listStaffDirectory,
} from '@work/lib/channels/queries'
import { countNewActivity, countUnreadMentions } from '@work/lib/inbox/queries'
import { countMyOpenTasks } from '@work/lib/tasks/queries'
import { getChannelSortPref, getChatSortPref } from '@work/lib/notifications/prefs'
import { activeStatus } from '@work/lib/notifications/status'
import { filterVisiblePeople, guestVisibleUserIds } from '@work/lib/staff/visibility'
import WorkShell from '@work/components/layout/WorkShell'
import SidebarLiveUpdates from '@work/components/chat/SidebarLiveUpdates'
import '@work/styles.css'

/**
 * 이사회 업무 화면 레이아웃 — 원본 kosmart-work `app/(app)/layout.tsx`(docs/board-work/01-설계.md §2-1).
 *
 * 전역 내비·푸터·포스터 테마(`ConditionalLayout`)와 이사회실 좌측 메뉴(`board-room/layout.tsx`) **안에서** 그린다
 * (docs/board-work/03-통합-재설계.md §4-1). 여기서 하는 일은 가드·`#전체` 자동 가입·목록 데이터 로드·`WorkShell`로 감싸기다.
 *
 * 원본과 다른 점:
 * - 가드는 `requireWorkStaff`(ggac 이사회 권한, 설계 §3). 처음 들어온 사람은 `#전체`에 넣는다(`ensureWorkspaceEntry`).
 * - 결재(지출결의)·위키 데이터는 읽지 않는다(가져오지 않는다). 할 일 배지(내 미완료 수)는 2b에서 켰다.
 * - 첫 사용 안내(OnboardingGate)는 옮기지 않는다. 푸시는 업무 설정 > 알림에서 켠다(5단계). 서비스 워커 등록은 WorkShell이 한다.
 * - 원본 `loading.tsx`는 두지 않는다 — 페이지가 스트리밍을 먼저 시작하면 `notFound()`가 404 상태 코드를 못 낸다
 *   (권한 E2E `authz-board-work.spec.ts`가 비공개 채널·남의 DM의 404를 본다).
 */
/**
 * **반드시 동적 렌더링.** 가드가 세션 쿠키를 읽지만, `readSessionUser`가 예외를 전부 삼키므로 정적 생성 중
 * Next가 던지는 "요청 데이터 필요" 신호도 삼켜진다 — 그러면 빌드 때 세션 없음으로 판정해 로그인 리다이렉트가
 * **정적 HTML로 구워진다**(실측 2026-10-29: 이 줄 없이 `/board-room/chat`이 SSG ●로 빌드됐다).
 * 하위 모든 업무툴 페이지에 적용된다. assert-runtime-risks.mjs가 이 선언을 못박는다.
 */
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: '업무 | 이사회',
  robots: { index: false, follow: false },
}

export default async function BoardWorkLayout({ children }: { children: React.ReactNode }) {
  // 미들웨어가 먼저 막지만(이사·감사·관리자만), 서버에서 한 번 더 판정한다.
  const ctx = await requireWorkStaff()
  const { user, staff } = ctx
  // 처음 들어온 사람을 #전체 채널에 넣는다(설계 §3, 멱등). 가드가 아니라 레이아웃 로더에서 한다.
  await ensureWorkspaceEntry(ctx)
  const isGuest = staff.role === 'guest'

  const [
    { channels, dms, dmPeers },
    directory,
    mentionCount,
    activityCount,
    visible,
    channelSort,
    chatSort,
    categories,
    openTaskCount,
  ] = await Promise.all([
    listSidebarChannels(ctx, user.id),
    listStaffDirectory(ctx),
    countUnreadMentions(ctx, user.id),
    countNewActivity(ctx),
    // 실패하면 나만 보이게(제한 쪽으로 실패) — 곁가지라 셸을 죽이지 않는다
    guestVisibleUserIds(ctx, staff).catch(err => {
      console.error('[board-work layout] 공동 멤버 조회 실패:', err)
      return new Set<string>([user.id])
    }),
    getChannelSortPref(ctx, user.id),
    getChatSortPref(ctx, user.id),
    listChannelCategories(ctx),
    countMyOpenTasks(ctx, user.id),
  ])

  // 1:1 DM 상대의 상태 메시지 — 만료된 것은 여기서 거른다
  const statusByUser = new Map(directory.map(s => [s.user_id, activeStatus(s)]))
  const dmsWithStatus = dms.map(d => {
    const status = d.kind === 'dm' && !d.group ? statusByUser.get(dmPeers?.[d.id] ?? '') : null
    return status ? { ...d, statusEmoji: status.emoji, statusText: status.text } : d
  })

  // ⌘K "사람": 지금 이사회 구성원(나 제외) — 고르면 DM 을 연다
  const people = filterVisiblePeople(
    directory.filter(s => s.status === 'active' && s.user_id !== user.id),
    visible,
    s => s.user_id
  ).map(s => ({ userId: s.user_id, name: s.display_name, title: s.title, role: s.role }))

  return (
    <div className="font-sans text-foreground">
      <WorkShell
        me={{
          displayName: staff.display_name,
          title: staff.title,
          status: statusByUser.get(user.id) ?? null,
        }}
        channels={channels}
        channelSort={channelSort}
        chatSort={chatSort}
        dms={dmsWithStatus}
        categories={categories}
        isAdmin={isWorkAdminRole(staff.role)}
        isGuest={isGuest}
        mentionCount={mentionCount}
        activityCount={activityCount}
        openTaskCount={openTaskCount}
        meId={user.id}
        dmPeers={isGuest ? {} : dmPeers}
        people={people}
      >
        {children}
        <SidebarLiveUpdates items={[...channels, ...dms]} me={user.id} />
      </WorkShell>
    </div>
  )
}
