// 상대경로 + 명시적 확장자로 임포트한다 — commentNotify.ts와 같은 이유
// (plain `node --test`에서 `@/` 별칭이 풀리지 않는다).
import { createNotification, createBulkNotifications } from '../../db/queries/notifications.ts'
import { createLogger } from '../../utils/logger.ts'

const log = createLogger('memberStatusNotify')

const DAY_MS = 24 * 60 * 60 * 1000
function daysFromNow(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString()
}

/**
 * 회원 상태 변경 알림 3종. 실패는 로깅만 하고 본 작업 흐름(승인/거부/아티스트
 * 배정)을 막지 않는다 — 호출부는 이 모듈의 모든 함수가 절대 throw하지
 * 않는다고 가정하고 그냥 `await`한다(`boardRoomNotify.notifyDirectors`와
 * 같은 계약).
 *
 * 원본: `supabase/migrations/20250719090050_create_notifications_table.sql`의
 * `notify_member_status_change()` 트리거 — 운영 DB에 적용된 적이 없다
 * (전수감사로 확인). **이 모듈은 전이 여부(실제로 상태가 바뀌었는지)를
 * 재검사하지 않는다** — 원본 트리거는 `OLD`/`NEW` 행을 직접 비교할 수
 * 있었지만, 이 모듈은 트리거가 아니라 앱 코드에서 호출되므로 그 비교는
 * 호출부(관리자 액션 라우트)의 몫이다. 호출부는 이미 "대상 상태가 아니면
 * 400으로 거부"하는 사전 검사를 거친 뒤에만(즉 전이가 실제로 일어난
 * 뒤에만) 이 함수들을 부른다 — 이미 approved인 회원을 다시 approved로
 * 저장해도 이 함수가 불리지 않는 것은 그 사전 검사 덕분이다.
 */

// ---------------------------------------------------------------- 단건

/** 회원 가입 승인(`member_approved`). pending → approved 전이가 실제로
 * 반영된 뒤에만 호출부가 불러야 한다. */
export async function notifyMemberApproved(memberId: string): Promise<void> {
  try {
    await createNotification({
      user_id: memberId,
      type: 'member_approved',
      title: '회원 가입이 승인되었습니다',
      message:
        '경기아트콜렉티브 협동조합에 오신 것을 환영합니다! 이제 모든 기능을 이용하실 수 있습니다.',
      data: { approved_at: new Date().toISOString() },
      expires_at: daysFromNow(90),
    })
  } catch (e) {
    log.error('회원 승인 알림 발송 실패', { memberId, error: (e as Error).message })
  }
}

/** 회원 가입 거부(`member_rejected`). pending → rejected 전이가 실제로
 * 반영된 뒤에만 호출부가 불러야 한다. */
export async function notifyMemberRejected(memberId: string): Promise<void> {
  try {
    await createNotification({
      user_id: memberId,
      type: 'member_rejected',
      title: '회원 가입이 거부되었습니다',
      message:
        '죄송합니다. 회원 가입 신청이 거부되었습니다. 문의사항이 있으시면 관리자에게 연락해 주세요.',
      data: { rejected_at: new Date().toISOString() },
      expires_at: daysFromNow(30),
    })
  } catch (e) {
    log.error('회원 거부 알림 발송 실패', { memberId, error: (e as Error).message })
  }
}

/** 아티스트 권한 승인(`artist_approved`). is_artist가 false → true로 실제로
 * 바뀐 뒤에만 호출부가 불러야 한다(이미 아티스트인 회원을 다른 아티스트로
 * 재배정하는 경우 등은 호출부가 걸러서 이 함수를 부르지 않는다). */
export async function notifyArtistApproved(memberId: string): Promise<void> {
  try {
    await createNotification({
      user_id: memberId,
      type: 'artist_approved',
      title: '아티스트 권한이 승인되었습니다',
      message: '축하합니다! 아티스트 권한이 승인되어 아티스트 프로필을 관리할 수 있습니다.',
      data: { artist_approved_at: new Date().toISOString() },
      expires_at: daysFromNow(90),
    })
  } catch (e) {
    log.error('아티스트 승인 알림 발송 실패', { memberId, error: (e as Error).message })
  }
}

// ---------------------------------------------------------------- 대량(배치)

/** 대량 승인 — 배치 INSERT 1회(`createBulkNotifications`). `memberIds`는
 * 호출부(`/api/admin/members/bulk`)가 이미 "pending → approved 전이가
 * 실제로 성공한 회원"만 걸러서 넘겨야 한다. */
export async function notifyMembersApprovedBatch(memberIds: string[]): Promise<void> {
  if (memberIds.length === 0) return
  try {
    await createBulkNotifications({
      user_ids: memberIds,
      type: 'member_approved',
      title: '회원 가입이 승인되었습니다',
      message:
        '경기아트콜렉티브 협동조합에 오신 것을 환영합니다! 이제 모든 기능을 이용하실 수 있습니다.',
      data: { approved_at: new Date().toISOString() },
      expires_at: daysFromNow(90),
    })
  } catch (e) {
    log.error('대량 회원 승인 알림 발송 실패', {
      count: memberIds.length,
      error: (e as Error).message,
    })
  }
}

/** 대량 거부 — 배치 INSERT 1회(`createBulkNotifications`). `memberIds`는
 * 호출부가 이미 "pending → rejected 전이가 실제로 성공한 회원"만 걸러서
 * 넘겨야 한다. */
export async function notifyMembersRejectedBatch(memberIds: string[]): Promise<void> {
  if (memberIds.length === 0) return
  try {
    await createBulkNotifications({
      user_ids: memberIds,
      type: 'member_rejected',
      title: '회원 가입이 거부되었습니다',
      message:
        '죄송합니다. 회원 가입 신청이 거부되었습니다. 문의사항이 있으시면 관리자에게 연락해 주세요.',
      data: { rejected_at: new Date().toISOString() },
      expires_at: daysFromNow(30),
    })
  } catch (e) {
    log.error('대량 회원 거부 알림 발송 실패', {
      count: memberIds.length,
      error: (e as Error).message,
    })
  }
}
