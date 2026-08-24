import type { NotificationType } from '@/types'

export const NOTIFICATION_TYPES = [
  'post_new',
  'post_reply',
  'post_mention',
  'member_approved',
  'member_rejected',
  'artist_approved',
  'artist_rejected',
  'system_notice',
  'maintenance',
  'welcome',
] as const satisfies readonly NotificationType[]

export function parseNotificationType(value: unknown): NotificationType | null {
  if (typeof value !== 'string') return null
  // NOTIFICATION_TYPES는 관리자 알림 생성 API가 허용하는 부분집합이라 이제
  // NotificationType 전체(board_notice 포함, 단계 2c Task 7)보다 좁다 —
  // `readonly string[]`로 넓혀서 비교해야 `.includes()`가 타입 에러 없이
  // "이 값이 그 부분집합에 속하는가"만 확인한다.
  return (NOTIFICATION_TYPES as readonly string[]).includes(value)
    ? (value as NotificationType)
    : null
}
