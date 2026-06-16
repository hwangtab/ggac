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
