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

    // 장터 글은 `posts`가 아니라 `market_listings`라 `/board/{id}`로 보내면 404다.
    case 'market_comment':
    case 'market_outbid':
    case 'market_auction_won':
    case 'market_auction_ended':
    case 'market_bid_received':
    case 'market_auction_canceled': {
      const listingId = notification.related_post_id
      if (listingId && UUID_PATTERN.test(listingId)) return `/board/market/${listingId}`
      return options.fallbackToNotifications ? '/notifications' : null
    }

    // 타임뱅크(스펙 §10). **case를 빠뜨리면 아래 default가 `/board/{id}`로 보내
    // 404다** — `scripts/testing/timebankNotify.test.mjs`가 종류마다 case가
    // 있는지 확인한다.
    case 'timebank_pending':
      return '/mypage/timebank#pending'

    case 'timebank_confirmed':
    case 'timebank_rejected':
    case 'timebank_canceled':
    case 'timebank_credited':
      return '/mypage/timebank'

    // 타임뱅크 글은 `timebank_listings`라 장터와 같은 이유로 전용 경로다.
    case 'timebank_comment':
    case 'timebank_volunteer': {
      const listingId = notification.related_post_id
      if (listingId && UUID_PATTERN.test(listingId)) return `/board/timebank/${listingId}`
      return options.fallbackToNotifications ? '/notifications' : null
    }

    case 'timebank_withdrawal_negative':
      return '/board-room/timebank'

    // 내 문서함 — 문서가 지워졌을 수 있어 목록으로 보낸다.
    case 'member_document_expiring':
    case 'member_document_deleted':
      return '/mypage/documents'

    default:
      return (
        getStoredUrlRoute(notification) ??
        getPostRoute(notification) ??
        (options.fallbackToNotifications ? '/notifications' : null)
      )
  }
}
