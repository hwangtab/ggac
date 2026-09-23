import type { NotificationType } from '@/types/notification'

/**
 * 알림 종류별 이름표와 색 — **화면과 테스트가 같은 표를 본다.**
 *
 * 화면 안에 표를 두었더니 종류가 늘 때마다 손으로 따라가야 했고, 실제로
 * `funding_shipped`가 검사 목록에서 한 회차 동안 빠져 있었다(정산 작업에서
 * 발견). 표를 밖으로 꺼내 두 가지를 얻는다.
 *
 * ① `Record<NotificationType, string>`이라 **종류를 늘리면 `tsc`가 먼저 막는다.**
 *    이름표나 색을 빠뜨린 채로는 빌드가 되지 않는다.
 * ② 테스트가 스키마의 종류 배열(`NOTIFICATION_TYPE`)과 이 표를 직접 대조할 수
 *    있다 — 소스를 정규식으로 훑지 않아도 된다.
 *
 * DB 스키마를 여기서 임포트하지 않는다. 이 모듈은 클라이언트 번들에 들어가고,
 * 스키마를 끌어오면 drizzle까지 딸려 온다. 스키마 배열과의 대조는 테스트가 한다.
 */

/** 목록의 이름표 배지 색. */
export const NOTIFICATION_TYPE_COLOR: Record<NotificationType, string> = {
  post_new: 'bg-blue-100 text-blue-800',
  post_reply: 'bg-green-100 text-green-800',
  post_mention: 'bg-purple-100 text-purple-800',
  member_approved: 'bg-green-100 text-green-800',
  member_rejected: 'bg-red-100 text-red-800',
  artist_approved: 'bg-emerald-100 text-emerald-800',
  artist_rejected: 'bg-red-100 text-red-800',
  system_notice: 'bg-yellow-100 text-yellow-800',
  maintenance: 'bg-orange-100 text-orange-800',
  welcome: 'bg-pink-100 text-pink-800',
  // 표를 밖으로 꺼내기 전에는 이 종류만 색이 없어 기본값(회색)으로 떨어졌다.
  // 그 모습을 그대로 적어 둔다 — 표를 옮기면서 화면의 색을 바꾸지 않는다.
  board_notice: 'bg-gray-100 text-gray-800',
  // 펀딩. 심사·승인·반려는 회원 승인 계열과 같은 색을 써서 "통과했다 /
  // 못 했다"가 목록에서 같은 뜻으로 읽히게 한다.
  funding_submitted: 'bg-indigo-100 text-indigo-800',
  funding_approved: 'bg-green-100 text-green-800',
  funding_rejected: 'bg-red-100 text-red-800',
  funding_pledged: 'bg-teal-100 text-teal-800',
  funding_closed: 'bg-gray-100 text-gray-800',
  funding_delivery_changed: 'bg-amber-100 text-amber-800',
  funding_refunded: 'bg-rose-100 text-rose-800',
  funding_shipped: 'bg-sky-100 text-sky-800',
  funding_settled: 'bg-purple-100 text-purple-800',
}

/** 목록에 보이는 한국어 이름. 영문 식별자가 그대로 보이던 것이 출발점이다. */
export const NOTIFICATION_TYPE_LABEL: Record<NotificationType, string> = {
  post_new: '새 게시글',
  post_reply: '댓글',
  post_mention: '멘션',
  member_approved: '회원 승인',
  member_rejected: '회원 거부',
  artist_approved: '아티스트 승인',
  artist_rejected: '아티스트 거부',
  system_notice: '시스템 공지',
  maintenance: '점검',
  welcome: '환영',
  board_notice: '이사회',
  funding_submitted: '펀딩 심사 요청',
  funding_approved: '펀딩 승인',
  funding_rejected: '펀딩 반려',
  funding_pledged: '펀딩 후원',
  funding_closed: '펀딩 마감',
  funding_delivery_changed: '리워드 전달 시기',
  funding_refunded: '후원 환불',
  funding_shipped: '리워드 발송',
  funding_settled: '펀딩 정산',
}

export function notificationTypeColor(type: NotificationType): string {
  return NOTIFICATION_TYPE_COLOR[type] ?? 'bg-gray-100 text-gray-800'
}

export function notificationTypeLabel(type: NotificationType): string {
  return NOTIFICATION_TYPE_LABEL[type] ?? type
}
