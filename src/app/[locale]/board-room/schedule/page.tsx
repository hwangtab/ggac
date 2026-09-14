import type { Locale } from '@/i18n/routing'
import { requireBoardMemberPage } from '@/lib/server/boardRoomPageAuth'
import ScheduleView from './ScheduleView'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface PageProps {
  params: Promise<{ locale: Locale }>
}

/**
 * 일정 투표는 이사·감사·관리자 전용이다. 화면 본체는 클라이언트
 * 컴포넌트(`ScheduleView`)이고, 이 서버 래퍼가 **미들웨어와 별개로** 한 번 더
 * 판정한다 — 경계가 경로 문자열 하나에만 걸려 있지 않게 한다.
 */
export default async function SchedulePage({ params }: PageProps) {
  const { locale } = await params
  await requireBoardMemberPage(locale, '/board-room/schedule')
  return <ScheduleView />
}
