import type { ActivityActionType, ActivityTargetType } from '@/types/activity'

export const ACTIVITY_ACTION_TYPES = [
  'login',
  'logout',
  'post_created',
  'post_updated',
  'post_deleted',
  'comment_created',
  'comment_deleted',
  'like_added',
  'like_removed',
  'profile_updated',
  'password_changed',
  'email_changed',
  'artist_profile_updated',
  'member_approved',
  'member_rejected',
  'admin_action',
  'file_uploaded',
  'file_deleted',
  'notification_read',
  'search_performed',
  'page_viewed',
  'attachment_downloaded',
  'funding_campaign_created',
  'funding_campaign_submitted',
  'funding_campaign_reviewed',
  'funding_pledge_paid',
  'funding_pledge_canceled',
  // 리워드의 예상 전달월 변경. 약관(제12조)이 전달 지연을 알리게 정할 뿐
  // 날짜를 얼리지 않으므로 변경은 막지 않는다 — 대신 보이게 남긴다.
  'funding_reward_delivery_changed',
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

export function parseActivityActionType(value: unknown): ActivityActionType | null {
  return typeof value === 'string' && ACTIVITY_ACTION_TYPES.includes(value as ActivityActionType)
    ? (value as ActivityActionType)
    : null
}

export function parseActivityTargetType(value: unknown): ActivityTargetType | null {
  return typeof value === 'string' && ACTIVITY_TARGET_TYPES.includes(value as ActivityTargetType)
    ? (value as ActivityTargetType)
    : null
}
