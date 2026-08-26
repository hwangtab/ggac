import { getDirectorRoster } from '@/lib/server/boardRoomAuth'
import { createBulkNotifications } from '@/db/queries/notifications'
import { createLogger } from '@/utils/logger'

const log = createLogger('boardRoomNotify')

type NotifyInput = {
  title: string
  message: string
  meetingId?: string
}

/**
 * 전체 재적 이사에게 board_notice 알림 발송. 실패는 로깅만(본 작업 흐름 막지 않음)
 *
 * 명단 조회(`getDirectorRoster`)와 발송(`createBulkNotifications`) 둘 다
 * Turso 쿼리 계층이다 — 단계 2c(Task 7)에서 Supabase
 * `create_bulk_notification` RPC를 걷어낸 뒤로, notifications가 Turso 권위가
 * 됐는데 이사회 알림만 Supabase에 쌓여 화면에 안 보이는 반쪽 전환은 없다.
 */
export async function notifyDirectors(input: NotifyInput): Promise<void> {
  let roster: { id: string }[]
  try {
    roster = await getDirectorRoster()
  } catch (e) {
    log.error('이사 명단 조회 실패', { error: (e as Error).message })
    return
  }

  if (roster.length === 0) return

  // 이사당 create_notification 호출을 N회 하는 대신 배치 INSERT 1회로
  // 대체한다(전수감사 API Low 22 — create_bulk_notification이 이미 존재).
  try {
    await createBulkNotifications({
      user_ids: roster.map(({ id }) => id),
      type: 'board_notice',
      title: input.title,
      message: input.message,
      data: input.meetingId
        ? { meeting_id: input.meetingId, scope: 'board-room' }
        : { scope: 'board-room' },
      expires_at: null,
    })
  } catch (e) {
    log.error('이사 알림 일괄 발송 실패', { count: roster.length, error: (e as Error).message })
  }
}
