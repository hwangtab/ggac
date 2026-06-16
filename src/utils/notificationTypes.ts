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
  return NOTIFICATION_TYPES.includes(value as NotificationType) ? (value as NotificationType) : null
}
