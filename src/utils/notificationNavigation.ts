import type { Notification } from '@/types'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * 알림을 만들 때 `data.url`에 넣어 둔 **절대 주소**를 이 앱의 경로로 되돌린다.
 *
 * 알림 본문과 메일이 같은 문장·같은 링크를 쓰기 때문에 저장된 값은 메일에
 * 그대로 실을 수 있는 절대 주소(`https://ggac.kr/ko/mypage/funding`)다.
 * 화면의 라우터는 로케일을 스스로 붙이므로 여기서는 **오리진과 로케일
 * 접두어를 걷어낸 경로**만 돌려준다.
 *
 * 다른 도메인이 들어 있으면 `null`이다 — 저장된 값이 무엇이든 앱 밖으로
 * 튕겨 보내지 않는다.
 */
const getStoredUrlRoute = (notification: Notification): string | null => {
  const raw = (notification.data as Record<string, unknown> | null)?.url
  if (typeof raw !== 'string' || raw.length === 0) return null

  let path: string
  if (raw.startsWith('/')) {
    path = raw
  } else {
    try {
      const parsed = new URL(raw)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
      path = `${parsed.pathname}${parsed.search}${parsed.hash}`
    } catch {
      return null
    }
  }
  // `//evil.com` 같은 프로토콜 상대 주소는 경로가 아니다.
  if (path.startsWith('//')) return null
  const stripped = path.replace(/^\/(?:ko|en)(?=\/|$)/, '')
  return stripped.length > 0 ? stripped : '/'
}

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

    // 펀딩 9종. 알림을 만든 쪽이 갈 곳을 이미 알고 있으므로(개설자 대시보드 ·
    // 공개 페이지 · 관리자 심사 목록 · 비회원 조회) 저장된 주소를 먼저 쓴다.
    // 없으면 적어도 화면이 있는 곳으로 보낸다.
    case 'funding_submitted':
      return getStoredUrlRoute(notification) ?? '/admin/funding'

    case 'funding_approved':
    case 'funding_rejected':
    case 'funding_closed':
    case 'funding_settled':
      return getStoredUrlRoute(notification) ?? '/mypage/funding'

    case 'funding_pledged':
    case 'funding_delivery_changed':
    case 'funding_refunded':
    case 'funding_shipped':
      return getStoredUrlRoute(notification) ?? '/mypage/funding'

    default:
      return (
        getStoredUrlRoute(notification) ??
        getPostRoute(notification) ??
        (options.fallbackToNotifications ? '/notifications' : null)
      )
  }
}
