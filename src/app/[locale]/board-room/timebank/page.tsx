import type { Locale } from '@/i18n/routing'
import { requireBoardMemberPage } from '@/lib/server/boardRoomPageAuth'
import OversightView from './OversightView'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface PageProps {
  params: Promise<{ locale: Locale }>
}

/**
 * 타임뱅크 보고(스펙 §7.4·§9.2·§12) — 이사·감사·관리자 전용. 화면 본체는 클라이언트
 * 컴포넌트(`OversightView`)이고, 이 서버 래퍼가 **미들웨어와 별개로** 한 번 더
 * 판정한다(일정 투표·메일함과 같다). 데이터는 `GET /api/board-room/timebank/oversight`
 * (`auth: 'board-member'`)가 다시 막는다.
 */
export default async function BoardRoomTimebankPage({ params }: PageProps) {
  const { locale } = await params
  await requireBoardMemberPage(locale, '/board-room/timebank')
  return <OversightView />
}
