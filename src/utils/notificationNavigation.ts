import type { Notification } from '@/types'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const getPostRoute = (notification: Notification): string | null => {
  const postId = notification.related_post_id
  if (!postId || !UUID_PATTERN.test(postId)) return null
  return `/board/${postId}`
}

export function getNotificationRoute(
  notification: Notification,
  options: { fallbackToNotifications?: boolean } = {}
): string | null {
  switch (notification.type) {
    case 'post_reply':
    case 'post_new':
    case 'post_mention':
      return getPostRoute(notification)

    case 'system_notice':
    case 'maintenance':
      return (
        getPostRoute(notification) ?? (options.fallbackToNotifications ? '/notifications' : null)
      )

    case 'member_approved':
    case 'member_rejected':
    case 'artist_approved':
    case 'artist_rejected':
      return '/mypage'

    case 'welcome':
      return '/'

    default:
      return (
        getPostRoute(notification) ?? (options.fallbackToNotifications ? '/notifications' : null)
      )
  }
}
