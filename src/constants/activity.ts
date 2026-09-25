import type { ActivityActionType, ActivityTargetType } from '@/types/activity'

/**
 * 브라우저가 **직접 기록할 수 있는** 활동 종류.
 *
 * `/api/activities/log`·`/api/activities/batch-log`는 로그인한 사람이면
 * 누구나 부를 수 있고, 본문의 `action_type`을 그대로 활동 원장에 적는다.
 * 그러니 이 목록에 있는 종류는 **"본인이 그렇게 주장했다"는 뜻**이지
 * "서버가 그 일을 했다"는 뜻이 아니다. 여기 있어도 되는 것은 위조돼도
 * 손해가 없는 참여 기록뿐이다 — 글·댓글·좋아요·프로필 수정·페이지 조회처럼
 * 서버 쪽 원장이 따로 있는 것들이다.
 *
 * 목록은 `src/utils/activityLogger.ts`(와 로그인 화면)가 실제로 보내는
 * 종류에서 왔다. 여기서 빼면 그 화면의 기록이 400으로 떨어지므로, 줄이거나
 * 늘릴 때는 그 파일을 함께 본다.
 */
export const CLIENT_LOGGABLE_ACTIVITY_ACTION_TYPES = [
  'login',
  'logout',
  'post_created',
  'post_updated',
  'comment_created',
  'like_added',
  'like_removed',
  'profile_updated',
  'file_uploaded',
  'notification_read',
  'search_performed',
  'page_viewed',
] as const satisfies readonly ActivityActionType[]

/**
 * **서버만** 적을 수 있는 활동 종류.
 *
 * 여기 있는 기록은 "서버가 이 일을 실제로 했다"는 증거로 쓰인다. 계좌·주소
 * 열람 기록(`member_account_viewed`·`funding_payout_account_viewed`·
 * `funding_shipping_exported`)이 대표적이다 — 조합원 목록에서 계좌를 뺀
 * 이유가 "누가 언제 남의 계좌를 봤는지 답할 수 있게"였으므로, 그 줄을
 * 아무나 만들 수 있으면 목록 전체가 증거로서 값을 잃는다.
 *
 * 승인·심사·관리 행위(`member_approved`·`admin_action` 등)와 결제 전이
 * (`funding_pledge_paid` 등), 비밀번호·이메일 변경도 같은 이유로 여기 있다.
 * 조합원이 스스로 "관리자가 나를 승인했다"고 적을 수 있으면 관리자 화면의
 * 활동 기록은 읽을 가치가 없다.
 *
 * 이 종류들은 라우트가 `logUserActivity()`를 **직접** 불러 적는다. 클라이언트
 * 기록 API는 이 목록의 값을 받으면 400으로 돌려보낸다.
 */
export const SERVER_ONLY_ACTIVITY_ACTION_TYPES = [
  'post_deleted',
  'comment_deleted',
  'password_changed',
  'email_changed',
  'artist_profile_updated',
  'member_approved',
  'member_rejected',
  'admin_action',
  'file_deleted',
  'attachment_downloaded',
  'funding_campaign_created',
  'funding_campaign_submitted',
  'funding_campaign_reviewed',
  'funding_pledge_paid',
  'funding_pledge_canceled',
  // 리워드의 예상 전달월 변경. 약관(제12조)이 전달 지연을 알리게 정할 뿐
  // 날짜를 얼리지 않으므로 변경은 막지 않는다 — 대신 보이게 남긴다.
  'funding_reward_delivery_changed',
  'funding_fulfillment_updated',
  'funding_shipping_exported',
  'funding_payout_account_viewed',
  'member_account_viewed',
] as const satisfies readonly ActivityActionType[]

/**
 * 원장에 존재할 수 있는 모든 활동 종류. 관리자 활동 화면의 **필터**가 쓴다
 * (필터는 이미 쓰인 값을 고르는 것이라 서버 전용 종류도 골라야 한다).
 * 기록 허가는 위 두 목록이 정한다.
 */
export const ACTIVITY_ACTION_TYPES = [
  ...CLIENT_LOGGABLE_ACTIVITY_ACTION_TYPES,
  ...SERVER_ONLY_ACTIVITY_ACTION_TYPES,
] as const satisfies readonly ActivityActionType[]

export const ACTIVITY_TARGET_TYPES = [
  'post',
  'comment',
  'user',
  'profile',
  'artist_profile',
  'file',
  'notification',
  'system',
  'inbound_email_attachment',
  'funding_campaign',
  'funding_pledge',
] as const satisfies readonly ActivityTargetType[]

/** 원장에 있을 수 있는 종류인가(필터·표시용). **기록 허가가 아니다.** */
export function parseActivityActionType(value: unknown): ActivityActionType | null {
  return typeof value === 'string' && ACTIVITY_ACTION_TYPES.includes(value as ActivityActionType)
    ? (value as ActivityActionType)
    : null
}

/**
 * 브라우저가 보낸 `action_type`을 받아들일 것인가.
 *
 * 클라이언트 기록 API는 **반드시 이쪽**을 쓴다. `parseActivityActionType`을
 * 쓰면 계좌 열람 기록처럼 서버가 증거로 남기는 줄을 아무나 위조할 수 있다.
 */
export function parseClientActivityActionType(value: unknown): ActivityActionType | null {
  const allowed: readonly string[] = CLIENT_LOGGABLE_ACTIVITY_ACTION_TYPES
  return typeof value === 'string' && allowed.includes(value) ? (value as ActivityActionType) : null
}

export function parseActivityTargetType(value: unknown): ActivityTargetType | null {
  return typeof value === 'string' && ACTIVITY_TARGET_TYPES.includes(value as ActivityTargetType)
    ? (value as ActivityTargetType)
    : null
}
