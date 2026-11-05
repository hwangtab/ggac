export type ActivityActionType =
  | 'login'
  | 'logout'
  | 'post_created'
  | 'post_updated'
  | 'post_deleted'
  | 'comment_created'
  | 'comment_deleted'
  | 'like_added'
  | 'like_removed'
  | 'profile_updated'
  | 'password_changed'
  | 'email_changed'
  | 'artist_profile_updated'
  | 'member_approved'
  | 'member_rejected'
  | 'admin_action'
  | 'file_uploaded'
  | 'file_deleted'
  | 'notification_read'
  | 'search_performed'
  | 'page_viewed'
  | 'attachment_downloaded'
  | 'mailbox_email_sent'
  | 'funding_campaign_created'
  | 'funding_campaign_created_by_admin'
  | 'funding_campaign_submitted'
  | 'funding_campaign_reviewed'
  | 'funding_pledge_paid'
  | 'funding_pledge_canceled'
  | 'funding_reward_delivery_changed'
  | 'funding_fulfillment_updated'
  | 'funding_shipping_exported'
  | 'funding_payout_account_viewed'
  | 'ticket_reservation_refunded'
  | 'member_account_viewed'
  | 'timebank_agreed' // 타임뱅크 이용규칙 동의
  | 'timebank_transfer_recorded' // 타임 기록(pending 생성)
  | 'timebank_transfer_decided' // 타임 기록 확인·거절·취소
  | 'timebank_coop_credit' // 조합 업무 크레딧 지급
  | 'timebank_adjustment' // 관리자 조정 생성
  | 'timebank_adjustment_approved' // 관리자 조정 이중 승인
  | 'timebank_settings_changed' // 타임뱅크 설정 변경(이사회 의결 근거)
  | 'timebank_coop_task_created' // 관리자의 조합 업무 글 등록
  | 'timebank_transfer_admin_canceled' // 관리자의 pending 취소(분쟁 정리)
  | 'board_document_version_saved' // 이사회 서류 앱 편집 저장(새 버전)
  | 'board_document_version_reverted' // 이사회 서류 버전 되돌리기

export type ActivityTargetType =
  | 'post'
  | 'comment'
  | 'user'
  | 'profile'
  | 'artist_profile'
  | 'file'
  | 'notification'
  | 'system'
  | 'inbound_email_attachment'
  | 'outbound_email'
  | 'outbound_email_attachment'
  | 'funding_campaign'
  | 'funding_pledge'
  | 'ticket_reservation'
  | 'timebank_transfer'
  | 'timebank_listing'
  | 'board_document'

export interface UserActivity {
  id: string
  user_id: string
  action_type: ActivityActionType
  target_type?: ActivityTargetType
  target_id?: string
  metadata: Record<string, any>
  ip_address?: string
  user_agent?: string
  session_id?: string
  created_at: string
}

export interface UserSession {
  id: string
  user_id: string
  session_token: string
  last_activity: string
  is_active: boolean
  ip_address?: string
  user_agent?: string
  login_at: string
  logout_at?: string
  metadata: Record<string, any>
}

export interface ActiveUser {
  user_id: string
  display_name: string
  email: string
  last_activity: string
  ip_address?: string
  activity_count_today: number
  session_token: string
  minutes_since_activity: number
}

export interface ActivityStats {
  action_type: ActivityActionType
  total_count: number
  unique_days: number
  avg_per_day: number
  first_activity: string
  last_activity: string
}

export interface ActivityFeedItem {
  id: string
  user_id: string
  user_name: string
  action_type: ActivityActionType
  target_type?: ActivityTargetType
  target_id?: string
  metadata: Record<string, any>
  created_at: string
  time_ago_text: string
}

export interface WeeklyActivityStats {
  week_start: string
  action_type: ActivityActionType
  total_count: number
  unique_users: number
  avg_time_between_actions?: number
}

export interface ActivityLogRequest {
  action_type: ActivityActionType
  target_type?: ActivityTargetType
  target_id?: string
  metadata?: Record<string, any>
}

export interface ActivityAnalyticsRequest {
  user_id?: string
  start_date?: string
  end_date?: string
  action_types?: ActivityActionType[]
  group_by?: 'day' | 'week' | 'month' | 'action_type' | 'user'
  page?: number
  limit?: number
}
