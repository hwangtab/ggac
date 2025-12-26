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

export type ActivityTargetType =
  | 'post'
  | 'comment'
  | 'user'
  | 'profile'
  | 'artist_profile'
  | 'file'
  | 'notification'
  | 'system'

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
