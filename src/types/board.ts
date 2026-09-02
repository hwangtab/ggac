import type { BoardCategory } from '@/constants/categories'

export interface Post {
  id: string
  title: string
  content: string
  content_format?: 'plain' | 'html' | 'markdown'
  category: BoardCategory
  author_id: string
  created_at: string
  updated_at?: string
  is_deleted?: boolean
  is_pinned?: boolean
  pinned_at?: string
  author?: {
    name: string
    email: string
    display_name?: string
  }
  comment_count?: number
  like_count?: number
  view_count?: number
  is_liked?: boolean
  attachments?: PostAttachment[]
  attachments_stats?: PostAttachmentStats
}

export interface PostWithLikes extends Post {
  like_count: number
  is_liked: boolean
}

export interface SupabaseRealtimePayload<T = any> {
  eventType?: string
  event_type?: string
  old?: T
  old_record?: T
  new?: T
  new_record?: T
  schema?: string
  table?: string
  commit_timestamp?: string
}

export interface PostAttachment {
  id: string
  post_id: string
  file_name: string
  file_url: string
  file_type: 'image' | 'document' | 'video' | 'audio'
  file_size: number
  mime_type: string
  alt_text?: string
  is_primary: boolean
  sort_order: number
  created_at: string
  updated_at?: string
}

/*
 * 임시/영구 첨부를 가르던 `TempPostAttachment`·`PermanentPostAttachment`·
 * `AnyPostAttachment`는 걷어냈다 — 아무 데서도 쓰이지 않았고, 임시 첨부라는
 * 개념 자체가 만들어질 수 없는 죽은 경로였다(2026-09-02).
 */

/*
 * 업로드 응답 타입(`FileUploadSuccessResponse`·`FileUploadErrorResponse`·
 * `FileUploadApiResponse`)도 함께 걷어냈다. 지운 `AnyPostAttachment`에
 * 의존했고, 저장소 어디서도 쓰이지 않았다 — 업로드 라우트는 `ApiSuccess`/
 * `ApiError`로 응답한다.
 */

export interface StrictFileValidationResult {
  readonly isValid: boolean
  readonly fileType: 'image' | 'document' | 'video' | 'audio' | null
  readonly errors: readonly string[]
  readonly warnings: readonly string[]
  readonly detectedMimeType?: string
  readonly detectedExtension?: string
  readonly securityRisk: 'none' | 'low' | 'medium' | 'high'
}

export interface UUIDValidationResult {
  readonly isValid: boolean
  readonly sanitized: string
  readonly errors: readonly string[]
  readonly warnings: readonly string[]
  readonly idType: 'uuid' | 'invalid'
}

export interface PostAttachmentUpload {
  file: File
  alt_text?: string
  is_primary?: boolean
}

export interface PostAttachmentStats {
  total_attachments: number
  total_size: number
  image_count: number
  document_count: number
  video_count: number
  audio_count: number
}

export interface PostLike {
  id: string
  post_id: string
  user_id: string
  created_at: string
}

export interface PostLikeToggleResponse {
  liked: boolean
  like_count: number
  message: string
}

export interface UserLikedPost {
  post_id: string
  post_title: string
  post_category: string
  post_author_name: string
  liked_at: string
}

export interface PostLikedUser {
  user_id: string
  display_name: string
  email: string
  liked_at: string
}

export interface PostLikeStats {
  post_id: string
  total_likes: number
  recent_users: PostLikedUser[]
  trend_percentage?: number
}

export interface Comment {
  id: string
  post_id: string
  content: string
  author_id: string
  created_at: string
  author?: {
    name: string
    email: string
  }
}

export interface CommentWithLikes extends Comment {
  like_count: number
  is_liked: boolean
}

export function isPost(obj: any): obj is Post {
  return (
    typeof obj === 'object' &&
    typeof obj.id === 'string' &&
    typeof obj.title === 'string' &&
    typeof obj.content === 'string' &&
    typeof obj.category === 'string' &&
    typeof obj.author_id === 'string' &&
    typeof obj.created_at === 'string'
  )
}
