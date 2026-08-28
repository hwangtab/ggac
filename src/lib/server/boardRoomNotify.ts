import { getAuditorRoster, getDirectorRoster } from '@/lib/server/boardRoomAuth'
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

type AgendaDiscussionInput = {
  meetingId: string
  agendaId: string
  agendaTitle: string
  /** 안건 제안자. 회원이 지워졌으면 `null`. */
  proposedBy: string | null
  /** 해당 안건에 이미 발언한 사람들. */
  participantIds: string[]
  /** 방금 쓴 사람 — 자기 댓글 알림은 받지 않는다. */
  actorId: string
  actorName: string
}

/**
 * 안건 토론 알림. 대상은 **제안자 + 그 안건에 이미 발언한 사람**이다
 * (본인 제외, 중복 제거). `notifyDirectors`처럼 이사 23명 전원에게 보내면
 * 댓글 하나에 알림 23건이 쌓여 이사회 알림 자체가 무시당한다.
 *
 * 실패는 로깅만 한다 — 댓글 작성 자체를 막지 않는다.
 */
export async function notifyAgendaDiscussion(input: AgendaDiscussionInput): Promise<void> {
  const candidates = Array.from(
    new Set([...(input.proposedBy ? [input.proposedBy] : []), ...input.participantIds])
  ).filter(id => id !== input.actorId)

  if (candidates.length === 0) return

  // 대상은 **지금** 이사회에 접근할 수 있는 사람으로 좁힌다. 후보는 과거
  // 기록(제안자·기존 발언자)에서 나오므로, 이사에서 내려온 사람이 그 명단에
  // 영원히 남는다 — 그대로 보내면 이사회 API가 전부 403인 사람에게 안건
  // 제목과 발언자 이름이 알림으로 계속 흘러간다. `notifyDirectors`가 매번
  // `getDirectorRoster()`를 다시 읽는 것과 같은 이유다(감사도 이사회를 보므로
  // 함께 허용한다).
  let allowed: Set<string>
  try {
    const [directors, auditors] = await Promise.all([getDirectorRoster(), getAuditorRoster()])
    allowed = new Set([...directors, ...auditors].map(({ id }) => id))
  } catch (e) {
    log.error('이사회 명단 조회 실패 — 토론 알림을 보내지 않는다', {
      agendaId: input.agendaId,
      error: (e as Error).message,
    })
    return
  }

  const recipients = candidates.filter(id => allowed.has(id))
  if (recipients.length === 0) return

  try {
    await createBulkNotifications({
      user_ids: recipients,
      type: 'board_notice',
      title: '안건 토론에 새 댓글',
      message: `'${input.agendaTitle}' 안건에 ${input.actorName} 님이 의견을 남겼습니다.`,
      data: {
        meeting_id: input.meetingId,
        agenda_id: input.agendaId,
        scope: 'board-room',
      },
      expires_at: null,
    })
  } catch (e) {
    log.error('안건 토론 알림 발송 실패', {
      agendaId: input.agendaId,
      count: recipients.length,
      error: (e as Error).message,
    })
  }
}
