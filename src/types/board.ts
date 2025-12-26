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

export interface TempPostAttachment extends PostAttachment {
  is_temporary: true
  temp_session: string
  expires_at: string
}

export interface PermanentPostAttachment extends PostAttachment {
  is_temporary: false
  temp_session?: never
  expires_at?: never
}

export type AnyPostAttachment = TempPostAttachment | PermanentPostAttachment

export interface FileUploadSuccessResponse {
  success: true
  message: string
  attachment: AnyPostAttachment
  url: string
  tempId?: string
  expiresAt?: string
}

export interface FileUploadErrorResponse {
  success: false
  error: string
  details?: string[]
}

export type FileUploadApiResponse = FileUploadSuccessResponse | FileUploadErrorResponse

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
  readonly idType: 'uuid' | 'temp-id' | 'invalid'
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
