import { SupabaseClient } from '@supabase/supabase-js'
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
 * `db: SupabaseClient`는 `getDirectorRoster`의 시그니처 호환을 위해 남아
 * 있지만 그 함수 내부는 이미 Turso(`listProfiles`)를 읽는다(Task 3). 알림
 * 자체도 단계 2c(Task 7)에서 Supabase `create_bulk_notification` RPC 호출을
 * Turso 쿼리 계층(`createBulkNotifications`, 배치 INSERT 1회)으로 옮겼다 —
 * notifications가 Turso 권위가 된 뒤에도 이사회 알림이 Supabase에만 쌓여
 * 화면에 안 보이는 반쪽 전환을 피하기 위해서다.
 */
export async function notifyDirectors(db: SupabaseClient, input: NotifyInput): Promise<void> {
  let roster: { id: string }[]
  try {
    roster = await getDirectorRoster(db)
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
