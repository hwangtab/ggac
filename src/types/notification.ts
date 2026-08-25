/**
 * 알림 시스템 타입 정의
 */

/**
 * 알림 유형
 */
export type NotificationType =
  | 'post_new' // 새 게시글 알림
  | 'post_reply' // 게시글 댓글 알림
  | 'post_mention' // 게시글 멘션 알림
  | 'member_approved' // 회원 승인 알림
  | 'member_rejected' // 회원 거부 알림
  | 'artist_approved' // 아티스트 권한 승인 알림
  | 'artist_rejected' // 아티스트 권한 거부 알림
  | 'system_notice' // 시스템 공지 알림
  | 'maintenance' // 점검 알림
  | 'welcome' // 환영 메시지
  | 'board_notice' // 이사회 알림(boardRoomNotify.ts) — DB 스키마
// (`src/db/schema/content.ts`의 `NOTIFICATION_TYPE`)에는 이미 있었지만 이
// 유니온에서 빠져 있었다(단계 2c Task 7에서 발견 — Turso 쿼리 계층이
// 이 타입을 구조적으로 검사하면서 드러남). 관리자 알림 생성 API의 허용
// 목록(`src/utils/notificationTypes.ts`의 `NOTIFICATION_TYPES`)에는 넣지
// 않는다 — board_notice는 이사회 기능 코드가 내부적으로만 만든다.

/**
 * 알림 인터페이스
 */
export interface Notification {
  /** 고유 식별자 */
  id: string
  /** 사용자 ID */
  user_id: string
  /** 알림 유형 */
  type: NotificationType
  /** 알림 제목 */
  title: string
  /** 알림 메시지 */
  message: string
  /** 추가 데이터 (JSON) */
  data: Record<string, any>
  /** 읽은 시간 (null이면 미읽음) */
  read_at: string | null
  /** 생성 시간 */
  created_at: string
  /** 만료 시간 (null이면 영구) */
  expires_at: string | null
  /** 연관 게시글 ID */
  related_post_id: string | null
  /** 연관 사용자 ID */
  related_user_id: string | null
}

/**
 * 알림 생성 요청
 */
export interface CreateNotificationRequest {
  /** 사용자 ID */
  user_id: string
  /** 알림 유형 */
  type: NotificationType
  /** 알림 제목 */
  title: string
  /** 알림 메시지 */
  message: string
  /** 추가 데이터 */
  data?: Record<string, any>
  /** 연관 게시글 ID */
  related_post_id?: string
  /** 연관 사용자 ID */
  related_user_id?: string
  /** 만료 시간 */
  expires_at?: string
}

/**
 * 대량 알림 생성 요청
 */
export interface CreateBulkNotificationRequest {
  /** 사용자 ID 배열 */
  user_ids: string[]
  /** 알림 유형 */
  type: NotificationType
  /** 알림 제목 */
  title: string
  /** 알림 메시지 */
  message: string
  /** 추가 데이터 */
  data?: Record<string, any>
  /** 만료 시간 */
  expires_at?: string
}

/**
 * 알림 통계
 */
export interface NotificationStats {
  /** 사용자 ID */
  user_id: string
  /** 전체 알림 수 */
  total_notifications: number
  /** 미읽은 알림 수 */
  unread_count: number
  /** 읽은 알림 수 */
  read_count: number
  /** 최근 알림 시간 */
  latest_notification_at: string | null
}

/**
 * 알림 목록 응답
 */
export interface NotificationListResponse {
  /** 알림 목록 */
  notifications: Notification[]
  /** 전체 개수 */
  total: number
  /** 미읽은 개수 */
  unread_count: number
  /** 페이지네이션 정보 */
  pagination: {
    page: number
    limit: number
    total_pages: number
    has_next: boolean
    has_prev: boolean
  }
}
