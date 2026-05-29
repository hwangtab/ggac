import { SupabaseClient } from '@supabase/supabase-js'
import { getDirectorRoster } from '@/lib/server/boardRoomAuth'
import { createLogger } from '@/utils/logger'

const log = createLogger('boardRoomNotify')

type NotifyInput = {
  title: string
  message: string
  meetingId?: string
}

/** 전체 재적 이사에게 board_notice 알림 발송. 실패는 로깅만(본 작업 흐름 막지 않음) */
export async function notifyDirectors(db: SupabaseClient, input: NotifyInput): Promise<void> {
  let roster: { id: string }[]
  try {
    roster = await getDirectorRoster(db)
  } catch (e) {
    log.error('이사 명단 조회 실패', { error: (e as Error).message })
    return
  }

  await Promise.all(
    roster.map(async ({ id }) => {
      const { error } = await db.rpc('create_notification', {
        p_user_id: id,
        p_type: 'board_notice',
        p_title: input.title,
        p_message: input.message,
        p_data: input.meetingId ? { meeting_id: input.meetingId, scope: 'board-room' } : { scope: 'board-room' },
        p_related_post_id: null,
        p_related_user_id: null,
        p_expires_at: null,
      })
      if (error) log.error('이사 알림 발송 실패', { userId: id.slice(0, 6), error: error.message })
    })
  )
}
