/**
 * 중앙화된 타입 정의 시스템
 * 모든 타입스크립트 인터페이스와 타입 정의를 중앙에서 관리
 */

import type { BoardCategory } from '@/constants/categories'

// === 핵심 데이터 타입 정의 ===

// === 사용자 설정 시스템 타입 정의 ===

/**
 * 설정 카테고리
 */
export type SettingCategory = 
  | 'notification'    // 알림 설정
  | 'privacy'        // 개인정보 설정
  | 'interface'      // 인터페이스 설정
  | 'security'       // 보안 설정
  | 'preference'     // 개인 취향 설정

/**
 * 사용자 설정 인터페이스
 */
export interface UserSetting {
  /** 고유 식별자 */
  id: string
  /** 사용자 ID */
  user_id: string
  /** 설정 카테고리 */
  category: SettingCategory
  /** 설정 키 */
  setting_key: string
  /** 설정 값 (JSON) */
  setting_value: Record<string, any>
  /** 생성 시간 */
  created_at: string
  /** 수정 시간 */
  updated_at: string
}

/**
 * 기본 설정값 템플릿 인터페이스
 */
export interface DefaultSetting {
  /** 고유 식별자 */
  id: string
  /** 설정 카테고리 */
  category: SettingCategory
  /** 설정 키 */
  setting_key: string
  /** 기본값 (JSON) */
  default_value: Record<string, any>
  /** 설정 설명 */
  description: string | null
  /** 필수 설정 여부 */
  is_required: boolean
  /** 생성 시간 */
  created_at: string
}

/**
 * 설정 조회 결과 인터페이스
 */
export interface SettingWithDefault {
  /** 설정 카테고리 */
  category: SettingCategory
  /** 설정 키 */
  setting_key: string
  /** 설정 값 (사용자 설정 또는 기본값) */
  setting_value: Record<string, any>
  /** 기본값 사용 여부 */
  is_default: boolean
  /** 설정 설명 */
  description: string | null
}

/**
 * 설정 업데이트 요청 인터페이스
 */
export interface SettingUpdateRequest {
  /** 설정 카테고리 */
  category: SettingCategory
  /** 설정 키 */
  setting_key: string
  /** 새로운 설정 값 */
  setting_value: Record<string, any>
}

/**
 * 일괄 설정 업데이트 결과 인터페이스
 */
export interface BulkSettingUpdateResult {
  /** 카테고리 */
  category: SettingCategory
  /** 설정 키 */
  setting_key: string
  /** 성공 여부 */
  success: boolean
  /** 설정 ID (성공 시) */
  setting_id?: string
  /** 오류 메시지 (실패 시) */
  error?: string
}

// === 프로필 사진 시스템 타입 정의 ===

/**
 * 프로필 사진 메타데이터 인터페이스
 */
export interface ProfilePhotoMetadata {
  /** 원본 파일명 */
  original_filename?: string
  /** 파일 크기 (바이트) */
  file_size?: number
  /** 콘텐츠 타입 */
  content_type?: string
  /** 이미지 너비 */
  width?: number
  /** 이미지 높이 */
  height?: number
  /** 업로드 시간 */
  uploaded_at?: string
  /** 처리 완료 여부 */
  processed?: boolean
  /** 다양한 크기의 이미지 버전들 */
  versions?: {
    thumbnail?: string
    medium?: string
    large?: string
  }
  /** 크롭 정보 */
  crop_info?: {
    x: number
    y: number
    width: number
    height: number
  }
}

/**
 * 프로필 사진 업로드 요청 인터페이스
 */
export interface ProfilePhotoUploadRequest {
  /** 업로드할 파일 */
  file: File
  /** 크롭 정보 (선택적) */
  crop_info?: {
    x: number
    y: number
    width: number
    height: number
  }
  /** 대체 텍스트 */
  alt_text?: string
}

/**
 * 프로필 사진 업로드 응답 인터페이스
 */
export interface ProfilePhotoUploadResponse {
  /** 성공 여부 */
  success: boolean
  /** 업로드된 사진 URL */
  photo_url?: string
  /** 생성된 메타데이터 */
  metadata?: ProfilePhotoMetadata
  /** 공개 URL */
  public_url?: string
  /** 오류 메시지 */
  error?: string
}

/**
 * 미디어 파일 정보 인터페이스
 */
export interface MediaFile {
  /** 고유 식별자 */
  id: string
  /** 파일명 */
  name: string
  /** 파일 크기 */
  size: number
  /** 콘텐츠 타입 */
  type: string
  /** Storage 경로 */
  path: string
  /** 공개 URL */
  public_url: string
  /** 업로드 시간 */
  uploaded_at: string
  /** 메타데이터 */
  metadata: Record<string, any>
}

/**
 * 이미지 크롭 설정 인터페이스
 */
export interface ImageCropSettings {
  /** 크롭 영역 X 좌표 */
  x: number
  /** 크롭 영역 Y 좌표 */
  y: number
  /** 크롭 영역 너비 */
  width: number
  /** 크롭 영역 높이 */
  height: number
  /** 최종 출력 크기 */
  output_size?: {
    width: number
    height: number
  }
  /** 종횡비 유지 여부 */
  maintain_aspect_ratio?: boolean
  /** 크롭 종횡비 */
  aspectRatio?: number
}

/**
 * MediaManager 설정 인터페이스
 */
export interface MediaManagerConfig {
  /** 최대 파일 크기 (바이트) */
  max_file_size: number
  /** 허용된 파일 타입들 */
  allowed_types: string[]
  /** 최대 업로드 파일 수 */
  max_files: number
  /** 이미지 자동 리사이징 여부 */
  auto_resize: boolean
  /** 최대 이미지 해상도 */
  max_resolution: {
    width: number
    height: number
  }
  /** 품질 설정 (0-100) */
  quality: number
  /** WebP 변환 여부 */
  convert_to_webp: boolean
}

// === 알림 시스템 타입 정의 ===

/**
 * 알림 유형
 */
export type NotificationType = 
  | 'post_new'          // 새 게시글 알림
  | 'post_reply'        // 게시글 댓글 알림
  | 'post_mention'      // 게시글 멘션 알림
  | 'member_approved'   // 회원 승인 알림
  | 'member_rejected'   // 회원 거부 알림
  | 'artist_approved'   // 아티스트 권한 승인 알림
  | 'artist_rejected'   // 아티스트 권한 거부 알림
  | 'system_notice'     // 시스템 공지 알림
  | 'maintenance'       // 점검 알림
  | 'welcome'           // 환영 메시지

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

// === 고급 필터링 시스템 타입 정의 ===

/**
 * 필터 연산자
 */
export type FilterOperator = 
  | 'equals'           // 같음
  | 'not_equals'       // 같지 않음
  | 'contains'         // 포함
  | 'not_contains'     // 포함하지 않음
  | 'starts_with'      // 시작
  | 'ends_with'        // 끝남
  | 'greater_than'     // 초과
  | 'greater_equal'    // 이상
  | 'less_than'        // 미만
  | 'less_equal'       // 이하
  | 'between'          // 범위
  | 'in'               // 목록에 포함
  | 'not_in'           // 목록에 미포함
  | 'is_null'          // null임
  | 'is_not_null'      // null이 아님

/**
 * 필터 조건
 */
export interface FilterCondition {
  /** 필드명 */
  field: string
  /** 연산자 */
  operator: FilterOperator
  /** 값 (배열 또는 단일 값) */
  value: any
  /** 값 타입 힌트 */
  type?: 'string' | 'number' | 'date' | 'boolean' | 'array' | 'select' | 'multiselect'
}

/**
 * 논리 연산자
 */
export type LogicalOperator = 'AND' | 'OR'

/**
 * 필터 그룹
 */
export interface FilterGroup {
  /** 논리 연산자 */
  operator: LogicalOperator
  /** 조건들 */
  conditions: FilterCondition[]
  /** 중첩 그룹들 */
  groups?: FilterGroup[]
}

/**
 * 정렬 방향
 */
export type SortDirection = 'asc' | 'desc'

/**
 * 정렬 조건
 */
export interface SortCondition {
  /** 필드명 */
  field: string
  /** 정렬 방향 */
  direction: SortDirection
  /** 우선순위 (낮을수록 우선) */
  priority?: number
}

/**
 * 고급 검색 쿼리
 */
export interface AdvancedSearchQuery {
  /** 필터 그룹 */
  filters?: FilterGroup
  /** 정렬 조건들 */
  sorts?: SortCondition[]
  /** 페이지네이션 */
  pagination?: {
    page: number
    limit: number
  }
  /** 포함할 관련 데이터 */
  include?: string[]
  /** 검색할 필드들 (전체 텍스트 검색용) */
  search?: {
    query: string
    fields: string[]
  }
}

/**
 * 필터 프리셋
 */
export interface FilterPreset {
  /** 프리셋 ID */
  id: string
  /** 프리셋 이름 */
  name: string
  /** 설명 */
  description?: string
  /** 적용 대상 (posts, members 등) */
  target: string
  /** 필터 설정 */
  query: AdvancedSearchQuery
  /** 생성자 */
  created_by?: string
  /** 공개 여부 */
  is_public?: boolean
  /** 생성일 */
  created_at?: string
}

/**
 * 필드 정의
 */
export interface FieldDefinition {
  /** 필드명 */
  name: string
  /** 표시명 */
  label: string
  /** 필드 타입 */
  type: 'string' | 'number' | 'date' | 'boolean' | 'select' | 'multiselect'
  /** 필터링 가능 여부 */
  filterable: boolean
  /** 정렬 가능 여부 */
  sortable: boolean
  /** 검색 가능 여부 */
  searchable: boolean
  /** 선택 옵션들 (select, multiselect 타입용) */
  options?: Array<{ value: any; label: string }>
  /** 지원하는 연산자들 */
  operators?: FilterOperator[]
  /** 기본 연산자 */
  defaultOperator?: FilterOperator
}

/**
 * 필터링 결과
 */
export interface FilteredResult<T = any> {
  /** 결과 데이터 */
  data: T[]
  /** 전체 개수 */
  total: number
  /** 필터된 개수 */
  filtered: number
  /** 페이지네이션 정보 */
  pagination: {
    page: number
    limit: number
    total_pages: number
    has_next: boolean
    has_prev: boolean
  }
  /** 적용된 필터 */
  applied_filters: FilterGroup
  /** 적용된 정렬 */
  applied_sorts: SortCondition[]
}

/**
 * 아티스트 정보 인터페이스
 * 예술가의 프로필 및 작품 정보를 담는 표준 인터페이스
 */
export interface Artist {
  /** 고유 식별자 */
  id: string
  /** URL 경로용 슬러그 */
  slug: string
  /** 아티스트 이름 */
  name: string
  /** 카테고리 (창작자, 기획자 등) */
  category: string | string[]
  /** 프로필 이미지 경로 */
  profileImage: string
  /** 한 줄 소개 */
  oneLiner: string
  /** 상세 소개 (마크다운 지원) */
  bio: string
  /** 템플릿 타입 (미니멀형, 콜라주형) */
  templateType: 'minimal' | 'collage' | '미니멀형' | '콜라주형'
  /** 포트폴리오 링크들 */
  portfolioLinks: PortfolioLink[] | null
  /** 유튜브 동영상들 */
  youtubeVideos?: YouTubeVideo[]
  /** 연락처 정보 */
  contact: string | null
}

/**
 * 프로젝트 정보 인터페이스
 * 작품 및 공연 정보를 담는 표준 인터페이스
 */
export interface Project {
  /** 고유 식별자 */
  id: string
  /** URL 경로용 슬러그 */
  slug: string
  /** 프로젝트 제목 */
  title: string
  /** 카테고리 */
  category: string
  /** 발행일 (YYYY-MM-DD 형식) */
  publishedDate: string
  /** 커버 이미지 경로 */
  coverImage: string
  /** 프로젝트 설명 */
  description: string
  /** 갤러리 이미지들 */
  gallery?: string[]
  /** 비디오 URL */
  videoUrl?: string | null
  /** 참여 아티스트 ID 목록 */
  artistIds: string[]
  /** 티켓팅 정보 */
  ticketing?: TicketingInfo[]
  /** 관련 기사들 */
  relatedArticles?: RelatedArticle[]
}

/**
 * 전역 설정 데이터 인터페이스
 * 사이트 전반의 설정 정보를 담는 인터페이스
 */
export interface GlobalData {
  /** 사이트 이름 */
  siteName: string
  /** 사이트 설명 */
  siteDescription: string
  /** 가입 신청 폼 URL */
  joinFormUrl: string
  /** 지원 신청 폼 URL */
  supportFormUrl: string
  /** 연락처 정보 */
  contact: ContactInfo
  /** 소셜 미디어 정보 */
  social: SocialInfo
  /** 사업자 정보 */
  businessInfo: BusinessInfo
}

// === 보조 타입 정의 ===

/**
 * 포트폴리오 링크 정보
 */
export interface PortfolioLink {
  /** 링크 제목 */
  title: string
  /** 링크 URL */
  url: string
}

/**
 * 유튜브 동영상 정보
 */
export interface YouTubeVideo {
  /** 동영상 제목 */
  title: string
  /** 유튜브 URL */
  url: string
}

/**
 * 티켓팅 정보
 */
export interface TicketingInfo {
  /** 티켓팅 플랫폼명 */
  platform: string
  /** 티켓팅 URL */
  url: string
  /** 예매 가능 여부 */
  available: boolean
  /** 가격 정보 */
  price?: string
  /** 예매 시작일 */
  startDate?: string
  /** 예매 종료일 */
  endDate?: string
  /** 매진일 */
  soldOutDate?: string
  /** 링크 프리뷰 데이터 (캐시용) */
  preview?: LinkPreview
}

/**
 * 관련 기사 정보
 */
export interface RelatedArticle {
  /** 기사 제목 */
  title: string
  /** 기사 URL */
  url: string
}

/**
 * 연락처 정보
 */
export interface ContactInfo {
  /** 이메일 주소 */
  email: string
  /** 전화번호 */
  phone: string
  /** 주소 */
  address: string
}

/**
 * 소셜 미디어 정보
 */
export interface SocialInfo {
  /** 인스타그램 URL */
  instagram: string
  /** 유튜브 URL */
  youtube: string
}

/**
 * 사업자 정보
 */
export interface BusinessInfo {
  /** 설립일 */
  establishedDate: string
  /** 등록일 */
  registrationDate: string
  /** 등록번호 */
  registrationNumber: string
}


// === API 응답 타입 정의 ===

/**
 * API 응답 기본 형태
 */
export interface ApiResponse<T = any> {
  /** 성공 여부 */
  success: boolean
  /** 응답 데이터 */
  data?: T
  /** 오류 메시지 */
  error?: string
  /** 상태 코드 */
  statusCode?: number
}

/**
 * 데이터 로딩 상태
 */
export type LoadingState = 'idle' | 'loading' | 'success' | 'error'

/**
 * 페이지네이션 정보
 */
export interface PaginationInfo {
  /** 현재 페이지 */
  currentPage: number
  /** 전체 페이지 수 */
  totalPages: number
  /** 페이지당 항목 수 */
  pageSize: number
  /** 전체 항목 수 */
  totalItems: number
}

/**
 * 검색 필터 옵션
 */
export interface SearchFilters {
  /** 카테고리 필터 */
  category?: string
  /** 검색 키워드 */
  query?: string
  /** 정렬 기준 */
  sortBy?: 'date' | 'name' | 'category'
  /** 정렬 순서 */
  sortOrder?: 'asc' | 'desc'
}

// === 컴포넌트 Props 타입 정의 ===

/**
 * 아티스트 카드 컴포넌트용 Props
 */
export interface ArtistCardProps {
  artist: Artist
  showCategory?: boolean
  showBio?: boolean
  className?: string
}

/**
 * 프로젝트 카드 컴포넌트용 Props
 */
export interface ProjectCardProps {
  project: Project
  showDescription?: boolean
  showArtists?: boolean
  className?: string
}

/**
 * 이미지 최적화 컴포넌트용 Props
 */
export interface OptimizedImageProps {
  src: string
  alt: string
  width?: number
  height?: number
  className?: string
  priority?: boolean
  fallbackText?: string
  fill?: boolean
  sizes?: string
  quality?: number
  preserveAspectRatio?: boolean
  onLoadStart?: () => void
  onLoad?: () => void
  onError?: () => void
  suppressSkeleton?: boolean
}

// === 유틸리티 타입 정의 ===

/**
 * 필수 필드만 포함하는 아티스트 요약 타입
 */
export type ArtistSummary = Pick<Artist, 'id' | 'slug' | 'name' | 'category' | 'profileImage' | 'oneLiner'>

/**
 * 필수 필드만 포함하는 프로젝트 요약 타입
 */
export type ProjectSummary = Pick<Project, 'id' | 'slug' | 'title' | 'category' | 'publishedDate' | 'coverImage' | 'description'>

/**
 * 폼 데이터 검증용 타입 (회원가입 등)
 */
export interface FormValidationResult {
  /** 검증 성공 여부 */
  isValid: boolean
  /** 오류 메시지들 */
  errors: Record<string, string>
  /** 정제된 데이터 */
  data?: any
}

// === 열거형 정의 ===

/**
 * 아티스트 카테고리
 */
export enum ArtistCategory {
  CREATOR = '창작자',
  ORGANIZER = '기획자',
  BOTH = '창작자/기획자'
}

/**
 * 프로젝트 카테고리
 */
export enum ProjectCategory {
  PERFORMANCE = '공연',
  EXHIBITION = '전시',
  MUSIC = '음악',
  MULTIMEDIA = '멀티미디어',
  COLLABORATION = '협업'
}

/**
 * 템플릿 타입
 */
export enum TemplateType {
  MINIMAL = '미니멀형',
  COLLAGE = '콜라주형'
}

// === 상수 정의 ===

/**
 * 기본 설정값들
 */
export const DEFAULT_VALUES = {
  /** 페이지당 아티스트 수 */
  ARTISTS_PER_PAGE: 12,
  /** 페이지당 프로젝트 수 */
  PROJECTS_PER_PAGE: 9,
  /** 홈페이지 featured 아티스트 수 */
  FEATURED_ARTISTS_COUNT: 6,
  /** 홈페이지 featured 프로젝트 수 */
  FEATURED_PROJECTS_COUNT: 3,
  /** 이미지 최적화 기본 품질 */
  IMAGE_QUALITY: 85,
  /** 캐시 만료 시간 (초) */
  CACHE_DURATION: 3600
} as const

/**
 * 미디어 쿼리 브레이크포인트
 */
export const BREAKPOINTS = {
  SM: '640px',
  MD: '768px',
  LG: '1024px',
  XL: '1280px',
  '2XL': '1536px'
} as const

/**
 * 타입 가드 함수들
 */

/**
 * Artist 타입 검증
 */
export function isArtist(obj: any): obj is Artist {
  return typeof obj === 'object' &&
    typeof obj.id === 'string' &&
    typeof obj.slug === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.oneLiner === 'string' &&
    typeof obj.bio === 'string'
}

/**
 * Project 타입 검증
 */
export function isProject(obj: any): obj is Project {
  return typeof obj === 'object' &&
    typeof obj.id === 'string' &&
    typeof obj.slug === 'string' &&
    typeof obj.title === 'string' &&
    typeof obj.category === 'string' &&
    typeof obj.publishedDate === 'string' &&
    Array.isArray(obj.artistIds)
}

/**
 * LinkPreview 타입 검증
 */
export function isLinkPreview(obj: any): obj is LinkPreview {
  return typeof obj === 'object' &&
    typeof obj.title === 'string' &&
    typeof obj.url === 'string'
}

// === 게시판 시스템 타입 정의 ===

/**
 * 게시글 인터페이스
 * Supabase posts 테이블과 연동되는 표준 인터페이스
 */
export interface Post {
  /** 고유 식별자 */
  id: string
  /** 게시글 제목 */
  title: string
  /** 게시글 내용 (마크다운 지원) */
  content: string
  /** 콘텐츠 형식 (plain, html, markdown) */
  content_format?: 'plain' | 'html' | 'markdown'
  /** 게시글 카테고리 */
  category: BoardCategory
  /** 작성자 ID */
  author_id: string
  /** 생성일시 (ISO 8601 형식) */
  created_at: string
  /** 수정일시 (ISO 8601 형식) */
  updated_at?: string
  /** 삭제 여부 (소프트 삭제) */
  is_deleted?: boolean
  /** 고정 여부 (공지사항 전용) */
  is_pinned?: boolean
  /** 고정일시 (ISO 8601 형식) */
  pinned_at?: string
  /** 작성자 정보 (조인된 데이터) */
  author?: {
    name: string
    email: string
    display_name?: string
  }
  /** 댓글 수 (조인된 데이터) */
  comment_count?: number
  /** 좋아요 수 */
  like_count?: number
  /** 조회수 */
  view_count?: number
  /** 현재 사용자의 좋아요 여부 */
  is_liked?: boolean
  /** 첨부파일 목록 (조인된 데이터) */
  attachments?: PostAttachment[]
  /** 첨부파일 통계 (목록 API 동시 제공) */
  attachments_stats?: PostAttachmentStats
}

/**
 * 좋아요 정보가 포함된 게시글 인터페이스
 * usePostsWithPagination에서 사용되는 확장된 Post 타입
 */
export interface PostWithLikes extends Post {
  /** 좋아요 수 (필수) */
  like_count: number
  /** 현재 사용자의 좋아요 여부 (필수) */
  is_liked: boolean
}

/**
 * Supabase 실시간 업데이트 페이로드 인터페이스
 */
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

/**
 * 게시글 첨부파일 인터페이스
 * Supabase post_attachments 테이블과 연동되는 표준 인터페이스
 */
export interface PostAttachment {
  /** 고유 식별자 */
  id: string
  /** 게시글 ID */
  post_id: string
  /** 원본 파일명 */
  file_name: string
  /** 파일 저장 URL */
  file_url: string
  /** 파일 종류 */
  file_type: 'image' | 'document' | 'video' | 'audio'
  /** 파일 크기 (바이트) */
  file_size: number
  /** MIME 타입 */
  mime_type: string
  /** 이미지 대체 텍스트 */
  alt_text?: string
  /** 대표 이미지 여부 */
  is_primary: boolean
  /** 정렬 순서 */
  sort_order: number
  /** 생성일시 */
  created_at: string
  /** 수정일시 */
  updated_at?: string
}

// 임시 첨부 파일에 대한 확장된 타입 정의
export interface TempPostAttachment extends PostAttachment {
  /** 임시 파일 여부 */
  is_temporary: true;
  /** 임시 세션 ID (사용자 ID) */
  temp_session: string;
  /** 만료 시간 */
  expires_at: string;
}

// 일반 첨부 파일 타입 (임시가 아닌)
export interface PermanentPostAttachment extends PostAttachment {
  /** 임시 파일 여부 */
  is_temporary: false;
  /** 임시 세션 ID (일반 파일은 null) */
  temp_session?: never;
  /** 만료 시간 (일반 파일은 null) */
  expires_at?: never;
}

// Union 타입으로 모든 첨부 파일 커버
export type AnyPostAttachment = TempPostAttachment | PermanentPostAttachment;

// 파일 업로드 응답에 대한 강화된 타입
export interface FileUploadSuccessResponse {
  success: true;
  message: string;
  attachment: AnyPostAttachment;
  url: string;
  // 임시 파일인 경우에만 존재
  tempId?: string;
  expiresAt?: string;
}

export interface FileUploadErrorResponse {
  success: false;
  error: string;
  details?: string[];
}

export type FileUploadApiResponse = FileUploadSuccessResponse | FileUploadErrorResponse;

// 파일 검증 결과에 대한 강화된 타입
export interface StrictFileValidationResult {
  readonly isValid: boolean;
  readonly fileType: 'image' | 'document' | 'video' | 'audio' | null;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly detectedMimeType?: string;
  readonly detectedExtension?: string;
  readonly securityRisk: 'none' | 'low' | 'medium' | 'high';
}

// UUID 검증 결과에 대한 강화된 타입
export interface UUIDValidationResult {
  readonly isValid: boolean;
  readonly sanitized: string;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly idType: 'uuid' | 'temp-id' | 'invalid';
}

// 보안 이벤트 로깅을 위한 타입
export type SecurityEventType = 
  // 기본 보안 이벤트
  | 'INVALID_UUID_OR_TEMP_ID_FORMAT'
  | 'TEMP_ID_USAGE'
  | 'MALICIOUS_UUID_ATTEMPT'
  | 'SUSPICIOUS_PATTERN_DETECTED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'UNAUTHORIZED_ACCESS_ATTEMPT'
  | 'XSS_ATTEMPT'
  | 'XSS_PATTERN_DETECTED'
  | 'INJECTION_ATTEMPT'
  | 'FILE_UPLOAD_VIOLATION'
  | 'INVALID_FILE_TYPE'
  | 'SUSPICIOUS_FILE_UPLOAD'
  | 'AUTHENTICATION_FAILURE'
  | 'SESSION_MANIPULATION'

  // 콘텐츠 보안 이벤트
  | 'CONTENT_VALIDATION_FAILED'
  | 'MALICIOUS_CONTENT_BLOCKED'
  | 'UNSAFE_HTML_DETECTED'
  | 'BLOCKED_IMAGE_PROXY_REQUEST'
  | 'UNSAFE_URL_BLOCKED'
  | 'CONTENT_SIZE_VIOLATION'
  | 'CSP_VIOLATION'
  | 'CONTENT_SANITIZED'

  // 이미지 프록시 보안 이벤트
  | 'IMAGE_PROXY_BLOCKED_DOMAIN'
  | 'IMAGE_PROXY_INVALID_URL'
  | 'IMAGE_PROXY_SIZE_EXCEEDED'
  | 'IMAGE_PROXY_TIMEOUT'
  | 'IMAGE_PROXY_FETCH_ERROR'
  | 'IMAGE_PROXY_ERROR'
  | 'BLOCKED_IMAGE_DOMAIN'
  | 'MALICIOUS_IMAGE_DOMAIN'

  // Rate Limiting 이벤트
  | 'RATE_LIMIT_GENERAL_API_EXCEEDED'
  | 'RATE_LIMIT_AUTH_API_EXCEEDED'
  | 'RATE_LIMIT_ADMIN_API_EXCEEDED'
  | 'RATE_LIMIT_POST_CREATION_EXCEEDED'
  | 'RATE_LIMIT_SEARCH_API_EXCEEDED'
  | 'RATE_LIMIT_FILE_UPLOAD_EXCEEDED'
  | 'RATE_LIMIT_BULK_OPERATIONS_EXCEEDED'
  | 'RATE_LIMIT_BLOCKED_ACCESS'
  | 'RATE_LIMIT_AUTO_BLOCK'

  // Admin API 보안 이벤트
  | 'ADMIN_ACTIVITY_API_ERROR'
  | 'ADMIN_MEMBERS_API_ERROR'
  | 'ADMIN_MEMBER_APPROVAL_ERROR'
  | 'ADMIN_MEMBER_UPDATE_ERROR'
  | 'ADMIN_MEMBER_ACTION_ERROR'
  | 'ADMIN_POSTS_API_ERROR'
  | 'ADMIN_POST_DELETE_ERROR'
  | 'ADMIN_POST_UPDATE_ERROR'
  | 'ADMIN_ARTISTS_API_ERROR'
  | 'ADMIN_ARTIST_UPDATE_ERROR'
  | 'ADMIN_ARTIST_DELETE_ERROR'
  | 'ADMIN_NOTIFICATIONS_API_ERROR'
  | 'ADMIN_NOTIFICATION_CREATE_ERROR'
  | 'ADMIN_NOTIFICATION_UPDATE_ERROR'
  | 'ADMIN_NOTIFICATION_DELETE_ERROR'
  | 'ADMIN_REPORTS_API_ERROR'
  | 'ADMIN_SETTINGS_API_ERROR'
  | 'ADMIN_SETTINGS_UPDATE_ERROR'
  | 'ADMIN_SETTINGS_ACCESS_ERROR'
  | 'ADMIN_SETTINGS_UPDATED'
  | 'ADMIN_SETTINGS_BACKUP_CREATED'
  | 'ADMIN_SETTINGS_BACKUP_ERROR'
  | 'ADMIN_SETTINGS_RESTORED'
  | 'ADMIN_SETTINGS_RESTORE_ERROR'
  | 'ADMIN_SETTINGS_RESET_TO_DEFAULTS'
  | 'ADMIN_SETTINGS_RESET_ERROR'
  | 'ADMIN_AUTH_ERROR'
  | 'ADMIN_PERMISSION_DENIED' 
  | 'ADMIN_INVALID_REQUEST'
  | 'ADMIN_DATABASE_ERROR'
  | 'ADMIN_EXPORT_ERROR'

  // 회원 관리 이벤트
  | 'MEMBER_REGISTRATION_BLOCKED'
  | 'MEMBER_APPROVAL_FAILED'
  | 'MEMBER_STATUS_CHANGE_FAILED'
  | 'MEMBER_PROFILE_UPDATE_BLOCKED'
  | 'MEMBER_DELETION_BLOCKED'
  | 'INVALID_MEMBER_ACTION'
  | 'MEMBER_STATUS_CHANGED'
  | 'INVALID_MEMBER_SEARCH'

  // 대량 작업 이벤트
  | 'INVALID_BULK_OPERATION'
  | 'BULK_OPERATION_COMPLETED'
  | 'BULK_OPERATION_ERROR'

  // 검색 이벤트
  | 'SEARCH_QUERY_BLOCKED'
  | 'SEARCH_INJECTION_ATTEMPT'
  | 'SEARCH_RATE_LIMIT_EXCEEDED'
  | 'INVALID_SEARCH_QUERY'

  // 설정 관리 이벤트
  | 'SETTINGS_UPDATE_BLOCKED'
  | 'SETTINGS_VALIDATION_FAILED'
  | 'ADMIN_SETTINGS_CACHE_INVALIDATED'
  | 'ADMIN_SETTINGS_CACHE_INVALIDATION_ERROR'
  
  // 파일 검증 관련 보안 이벤트
  | 'DANGEROUS_FILE_EXTENSION'
  | 'SUSPICIOUS_IMAGE_URL'
  | 'DANGEROUS_QUERY_PARAM'
  | 'IMAGE_WHITELIST_UPDATED'
  | 'IMAGE_BLACKLIST_UPDATED'
  | 'XSS_ATTEMPT_IN_EMAIL'
  | 'SQL_INJECTION_ATTEMPT'
  | 'MALICIOUS_PHONE_NUMBER'
  | 'MALICIOUS_USERNAME'
  | 'XSS_ATTEMPT_IN_TITLE'
  | 'XSS_ATTEMPT_IN_CONTENT'
  | 'MALICIOUS_URL'
  | 'MALICIOUS_FILENAME'
  | 'SQL_INJECTION_IN_SEARCH'
  | 'XSS_IN_SEARCH';

export type SecurityEventSeverity = 'low' | 'medium' | 'high';

export interface SecurityEventContext {
  readonly [key: string]: unknown;
  readonly timestamp?: string;
  readonly userAgent?: string;
  readonly clientIP?: string;
}

// CSP 위반 리포트 타입
export interface CSPViolationReport {
  readonly 'document-uri': string;
  readonly referrer: string;
  readonly 'violated-directive': string;
  readonly 'effective-directive': string;
  readonly 'original-policy': string;
  readonly disposition: string;
  readonly 'blocked-uri': string;
  readonly 'line-number'?: number;
  readonly 'column-number'?: number;
  readonly 'source-file'?: string;
}

export interface CSPReportWrapper {
  readonly 'csp-report': CSPViolationReport;
}

// 클린업 작업에 대한 타입
export interface TempFileCleanupResult {
  readonly message: string;
  readonly cleaned: number;
  readonly files: readonly {
    readonly id: string;
    readonly fileName: string;
  }[];
}

export interface TempFileCleanupStats {
  readonly total: number;
  readonly active: number;
  readonly expired: number;
  readonly totalSize: number;
  readonly expiredSize: number;
  readonly expiredSizeMB: number;
}

/**
 * 첨부파일 업로드 요청
 */
export interface PostAttachmentUpload {
  /** 파일 객체 */
  file: File
  /** 이미지 대체 텍스트 */
  alt_text?: string
  /** 대표 이미지 여부 */
  is_primary?: boolean
}

/**
 * 첨부파일 통계
 */
export interface PostAttachmentStats {
  /** 총 첨부파일 수 */
  total_attachments: number
  /** 총 파일 크기 */
  total_size: number
  /** 이미지 파일 수 */
  image_count: number
  /** 문서 파일 수 */
  document_count: number
  /** 비디오 파일 수 */
  video_count: number
  /** 오디오 파일 수 */
  audio_count: number
}

// === 게시글 좋아요 시스템 타입 정의 ===

/**
 * 게시글 좋아요 정보
 */
export interface PostLike {
  /** 고유 식별자 */
  id: string
  /** 게시글 ID */
  post_id: string
  /** 사용자 ID */
  user_id: string
  /** 좋아요한 시간 */
  created_at: string
}

/**
 * 게시글 좋아요 토글 응답
 */
export interface PostLikeToggleResponse {
  /** 좋아요 상태 (true: 좋아요함, false: 좋아요 취소) */
  liked: boolean
  /** 현재 좋아요 수 */
  like_count: number
  /** 메시지 */
  message: string
}

/**
 * 사용자 좋아요 목록 항목
 */
export interface UserLikedPost {
  /** 게시글 ID */
  post_id: string
  /** 게시글 제목 */
  post_title: string
  /** 게시글 카테고리 */
  post_category: string
  /** 게시글 작성자 이름 */
  post_author_name: string
  /** 좋아요한 시간 */
  liked_at: string
}

/**
 * 게시글 좋아요한 사용자 정보
 */
export interface PostLikedUser {
  /** 사용자 ID */
  user_id: string
  /** 사용자 표시 이름 */
  display_name: string
  /** 사용자 이메일 */
  email: string
  /** 좋아요한 시간 */
  liked_at: string
}

/**
 * 좋아요 통계 정보
 */
export interface PostLikeStats {
  /** 게시글 ID */
  post_id: string
  /** 총 좋아요 수 */
  total_likes: number
  /** 최근 좋아요한 사용자들 */
  recent_users: PostLikedUser[]
  /** 좋아요 증가 추세 (최근 7일 vs 이전 7일) */
  trend_percentage?: number
}

// === 활동 추적 시스템 타입 정의 ===

/**
 * 활동 타입 열거형
 */
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

/**
 * 대상 타입 열거형
 */
export type ActivityTargetType = 
  | 'post'
  | 'comment'
  | 'user'
  | 'profile'
  | 'artist_profile'
  | 'file'
  | 'notification'
  | 'system'

/**
 * 사용자 활동 기록
 */
export interface UserActivity {
  /** 고유 식별자 */
  id: string
  /** 사용자 ID */
  user_id: string
  /** 활동 타입 */
  action_type: ActivityActionType
  /** 대상 타입 */
  target_type?: ActivityTargetType
  /** 대상 ID */
  target_id?: string
  /** 메타데이터 */
  metadata: Record<string, any>
  /** IP 주소 */
  ip_address?: string
  /** User Agent */
  user_agent?: string
  /** 세션 ID */
  session_id?: string
  /** 생성 시간 */
  created_at: string
}

/**
 * 사용자 세션 정보
 */
export interface UserSession {
  /** 고유 식별자 */
  id: string
  /** 사용자 ID */
  user_id: string
  /** 세션 토큰 */
  session_token: string
  /** 마지막 활동 시간 */
  last_activity: string
  /** 활성 상태 */
  is_active: boolean
  /** IP 주소 */
  ip_address?: string
  /** User Agent */
  user_agent?: string
  /** 로그인 시간 */
  login_at: string
  /** 로그아웃 시간 */
  logout_at?: string
  /** 메타데이터 */
  metadata: Record<string, any>
}

/**
 * 활성 사용자 정보
 */
export interface ActiveUser {
  /** 사용자 ID */
  user_id: string
  /** 표시 이름 */
  display_name: string
  /** 이메일 */
  email: string
  /** 마지막 활동 시간 */
  last_activity: string
  /** IP 주소 */
  ip_address?: string
  /** 오늘 활동 수 */
  activity_count_today: number
  /** 세션 토큰 */
  session_token: string
  /** 마지막 활동으로부터 경과 시간 (분) */
  minutes_since_activity: number
}

/**
 * 활동 통계
 */
export interface ActivityStats {
  /** 활동 타입 */
  action_type: ActivityActionType
  /** 총 활동 수 */
  total_count: number
  /** 활동한 일수 */
  unique_days: number
  /** 일평균 활동 수 */
  avg_per_day: number
  /** 첫 번째 활동 시간 */
  first_activity: string
  /** 마지막 활동 시간 */
  last_activity: string
}

/**
 * 실시간 활동 피드 항목
 */
export interface ActivityFeedItem {
  /** 고유 식별자 */
  id: string
  /** 사용자 ID */
  user_id: string
  /** 사용자 이름 */
  user_name: string
  /** 활동 타입 */
  action_type: ActivityActionType
  /** 대상 타입 */
  target_type?: ActivityTargetType
  /** 대상 ID */
  target_id?: string
  /** 메타데이터 */
  metadata: Record<string, any>
  /** 생성 시간 */
  created_at: string
  /** 상대적 시간 텍스트 */
  time_ago_text: string
}

/**
 * 주간 활동 통계
 */
export interface WeeklyActivityStats {
  /** 주 시작일 */
  week_start: string
  /** 활동 타입 */
  action_type: ActivityActionType
  /** 총 활동 수 */
  total_count: number
  /** 유니크 사용자 수 */
  unique_users: number
  /** 활동 간 평균 시간 */
  avg_time_between_actions?: number
}

/**
 * 활동 로깅 요청
 */
export interface ActivityLogRequest {
  /** 활동 타입 */
  action_type: ActivityActionType
  /** 대상 타입 */
  target_type?: ActivityTargetType
  /** 대상 ID */
  target_id?: string
  /** 메타데이터 */
  metadata?: Record<string, any>
}

/**
 * 활동 분석 요청
 */
export interface ActivityAnalyticsRequest {
  /** 사용자 ID (null이면 전체) */
  user_id?: string
  /** 시작 날짜 */
  start_date?: string
  /** 종료 날짜 */
  end_date?: string
  /** 활동 타입 필터 */
  action_types?: ActivityActionType[]
  /** 그룹화 기준 */
  group_by?: 'day' | 'week' | 'month' | 'action_type' | 'user'
  /** 페이지네이션 */
  page?: number
  /** 페이지당 항목 수 */
  limit?: number
}

/**
 * 댓글 인터페이스
 * Supabase comments 테이블과 연동되는 표준 인터페이스
 */
export interface Comment {
  /** 고유 식별자 */
  id: string
  /** 게시글 ID */
  post_id: string
  /** 댓글 내용 */
  content: string
  /** 작성자 ID */
  author_id: string
  /** 생성일시 (ISO 8601 형식) */
  created_at: string
  /** 작성자 정보 (조인된 데이터) */
  author?: {
    name: string
    email: string
  }
}

/**
 * 좋아요 정보가 포함된 댓글 인터페이스
 * CommentSection에서 사용되는 확장된 Comment 타입
 */
export interface CommentWithLikes extends Comment {
  /** 좋아요 수 */
  like_count: number
  /** 현재 사용자의 좋아요 여부 */
  is_liked: boolean
}

/**
 * Post 타입 검증
 */
export function isPost(obj: any): obj is Post {
  return typeof obj === 'object' &&
    typeof obj.id === 'string' &&
    typeof obj.title === 'string' &&
    typeof obj.content === 'string' &&
    typeof obj.category === 'string' &&
    typeof obj.author_id === 'string' &&
    typeof obj.created_at === 'string'
}

// === 컴포넌트 Props 타입 정의 ===

/**
 * 최적화된 이미지 컴포넌트 Props
 * WebP 지원, 폴백 처리, 반응형 지원
 */
export interface OptimizedImageProps {
  /** 이미지 소스 URL */
  src: string
  /** 대체 텍스트 */
  alt: string
  /** 이미지 너비 */
  width?: number
  /** 이미지 높이 */
  height?: number
  /** CSS 클래스명 */
  className?: string
  /** 로딩 우선순위 */
  priority?: boolean
  /** fill 모드 사용 여부 */
  fill?: boolean
  /** 반응형 크기 설정 */
  sizes?: string
  /** 이미지 품질 (1-100) */
  quality?: number
  /** 이미지 로드 실패 시 표시할 텍스트 */
  fallbackText?: string
  /** 원본 비율 유지 여부 */
  preserveAspectRatio?: boolean
  /** @deprecated preferWebp는 더 이상 사용되지 않음. Next.js가 자동으로 AVIF/WebP 선택 */
  preferWebp?: boolean
}

/**
 * 링크 미리보기 정보
 * 외부 링크의 메타데이터를 담는 인터페이스
 */
export interface LinkPreview {
  /** 페이지 제목 */
  title: string
  /** 페이지 설명 */
  description: string
  /** 대표 이미지 URL */
  image: string
  /** 사이트명 */
  siteName: string
  /** 원본 URL */
  url: string
  /** 파비콘 URL */
  favicon: string
}

/**
 * 티켓팅 정보
 * 공연/이벤트 예매 관련 정보
 */
export interface TicketingInfo {
  /** 플랫폼명 */
  platform: string
  /** 예매 URL */
  url: string
  /** 예매 가능 여부 */
  available: boolean
  /** 예매 시작일 */
  startDate?: string
  /** 예매 종료일 */
  endDate?: string
  /** 매진일 */
  soldOutDate?: string
  /** 링크 미리보기 (캐시된 데이터) */
  preview?: LinkPreview
}

/**
 * 기사/아티클 정보
 * 외부 링크 기사의 메타데이터
 */
export interface ArticleInfo {
  /** 기사 제목 */
  title: string
  /** 기사 URL */
  url: string
  /** 링크 미리보기 (캐시된 데이터) */
  preview?: LinkPreview
}

// === 컴포넌트 Props 타입들 ===

export interface ArticleCardProps {
  article: ArticleInfo
}

export interface TicketingCardProps {
  ticketing: TicketingInfo
}

export interface FeaturedArtistsProps {
  artists: Artist[]
}

export interface FeaturedProjectsProps {
  projects: Project[]
}

export interface BaseCardProps {
  title: string
  description: string
  category?: string
  image?: {
    src: string
    alt: string
    width?: number
    height?: number
  }
  href?: string
  date?: string
  author?: string
  className?: string
  variant?: 'default' | 'compact' | 'featured'
  hoverable?: boolean
  imagePosition?: 'top' | 'left' | 'right'
  footer?: React.ReactNode
  onClick?: () => void
}

export interface ArtistProjectsProps {
  projects: Project[]
  artistName?: string
  className?: string
}

// === 마이페이지 시스템 타입 정의 ===

/**
 * 확장된 멤버 프로필 인터페이스
 * 아티스트 관련 필드가 추가됨
 */
export interface MemberProfile {
  /** 고유 식별자 (UUID) */
  id: string
  /** 표시명 */
  display_name: string
  /** 이메일 주소 */
  email: string
  /** 전화번호 */
  phone_number?: string
  /** 생년월일 */
  birth_date?: string
  /** 실명 */
  real_name?: string
  /** 조합비 */
  monthly_fee?: number
  /** 은행명 */
  bank_name?: string
  /** 계좌번호 */
  account_number?: string
  /** 예금주 */
  account_holder?: string
  /** 등록 상태 */
  registration_status: 'pending' | 'approved' | 'rejected'
  /** 활성 상태 */
  is_active: boolean
  /** 관리자 여부 */
  is_admin: boolean
  /** 조합원 여부 */
  is_member: boolean
  /** 생성일시 */
  created_at: string
  /** 수정일시 */
  updated_at: string
  /** 승인일시 */
  approved_at?: string
  /** 승인자 */
  approved_by?: string
  /** 거부자 */
  rejected_by?: string
  
  // 아티스트 관련 필드
  /** 연결된 아티스트 ID */
  artist_id?: string | null
  /** 아티스트 여부 */
  is_artist: boolean
  /** 아티스트 역할 */
  artist_role: 'owner' | 'manager' | 'collaborator'
  
  // 프로필 사진 관련 필드
  /** 프로필 사진 URL */
  profile_photo_url?: string | null
  /** 프로필 사진 메타데이터 */
  profile_photo_metadata?: ProfilePhotoMetadata
  
  // 새로운 상태 관리 필드
  /** 마지막 로그인 시간 */
  last_login_at?: string
  /** 정지 여부 */
  is_suspended: boolean
  /** 정지 사유 */
  suspension_reason?: string
  /** 정지 해제 일시 */
  suspension_until?: string
  /** 프로필 완성도 점수 (0-100) */
  profile_completeness_score: number
  /** 인증 상태 */
  verification_status: {
    email: boolean
    phone: boolean
    identity: boolean
  }
  /** 멤버십 타입 */
  membership_type: 'regular' | 'premium' | 'lifetime'
  /** 참여도 점수 */
  engagement_score: number
}

/**
 * 데이터베이스 기반 아티스트 인터페이스
 * 기존 JSON 기반 Artist 인터페이스를 확장하여 DB 필드 추가
 */
export interface DatabaseArtist {
  /** UUID 기본 키 */
  id: string
  /** 기존 아티스트 ID (artist-001 형태) */
  legacy_id: string
  /** URL 슬러그 */
  slug: string
  /** 아티스트 이름 */
  name: string
  /** 카테고리 배열 */
  category: string[]
  /** 프로필 사진 URL (Supabase Storage) */
  profile_photo_url: string | null
  /** 프로필 사진 메타데이터 */
  profile_photo_metadata?: ProfilePhotoMetadata
  /** 프로필 이미지 경로 (기존 방식, 마이그레이션 후 삭제 예정) */
  profile_image?: string
  /** 한 줄 소개 */
  one_liner: string
  /** 상세 소개 (마크다운) */
  bio: string
  /** 템플릿 타입 */
  template_type: '미니멀형' | '콜라주형'
  /** 포트폴리오 링크 JSON */
  portfolio_links: PortfolioLink[]
  /** 유튜브 동영상 JSON */
  youtube_videos: YouTubeVideo[]
  /** 연락처 */
  contact: string
  /** 생성일시 */
  created_at: string
  /** 수정일시 */
  updated_at: string
  
  /** 연결된 멤버 정보 (조인 시 사용) */
  members?: {
    id: string
    display_name: string
    artist_role: 'owner' | 'manager' | 'collaborator'
    is_active: boolean
    registration_status: 'pending' | 'approved' | 'rejected'
  }[]
}

/**
 * 아티스트-멤버 관계 뷰 인터페이스
 */
export interface ArtistMemberRelation {
  /** 아티스트 UUID */
  artist_uuid: string
  /** 아티스트 레거시 ID */
  artist_id: string
  /** 아티스트 슬러그 */
  slug: string
  /** 아티스트 이름 */
  artist_name: string
  /** 멤버 ID */
  member_id: string
  /** 멤버 이름 */
  member_name: string
  /** 아티스트 역할 */
  artist_role: 'owner' | 'manager' | 'collaborator'
  /** 멤버 활성 상태 */
  member_active: boolean
  /** 멤버 등록 상태 */
  registration_status: 'pending' | 'approved' | 'rejected'
}

// === 마이페이지 컴포넌트 Props 타입 정의 ===

/**
 * 마이페이지 레이아웃 Props
 */
export interface MypageLayoutProps {
  children: React.ReactNode
  title: string
  description?: string
  className?: string
}

/**
 * 권한 체크 컴포넌트 Props
 */
export interface PermissionCheckProps {
  children: React.ReactNode
  requiredPermission: 'member' | 'artist' | 'admin'
  fallback?: React.ReactNode
  redirectTo?: string
}

/**
 * 프로필 편집 폼 Props
 */
export interface ProfileEditFormProps {
  profile: MemberProfile
  onUpdate: (updates: Partial<MemberProfile>) => Promise<void>
  loading?: boolean
  className?: string
}

/**
 * 아티스트 편집 폼 Props
 */
export interface ArtistEditFormProps {
  artist: DatabaseArtist
  onUpdate: (updates: Partial<DatabaseArtist>) => Promise<void>
  loading?: boolean
  className?: string
}

/**
 * 미디어 매니저 Props
 */
export interface MediaManagerProps {
  currentImage?: string
  onImageUpdate: (imageUrl: string) => void
  loading?: boolean
  maxSize?: number // bytes
  acceptedTypes?: string[]
  className?: string
}

/**
 * 포트폴리오 링크 매니저 Props
 */
export interface PortfolioLinksProps {
  links: PortfolioLink[]
  onChange: (links: PortfolioLink[]) => void
  maxLinks?: number
  className?: string
}

/**
 * 유튜브 동영상 매니저 Props
 */
export interface YoutubeVideosProps {
  videos: YouTubeVideo[]
  onChange: (videos: YouTubeVideo[]) => void
  maxVideos?: number
  className?: string
}

/**
 * 마크다운 에디터 Props
 */
export interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  minHeight?: number
  maxHeight?: number
  className?: string
}

// === 마이페이지 API 타입 정의 ===

/**
 * 프로필 업데이트 요청 타입
 */
export interface ProfileUpdateRequest {
  display_name?: string
  phone_number?: string
  birth_date?: string
  monthly_fee?: number
  bank_name?: string
  account_number?: string
  account_holder?: string
}

/**
 * 아티스트 업데이트 요청 타입
 */
export interface ArtistUpdateRequest {
  name?: string
  category?: string[]
  one_liner?: string
  bio?: string
  template_type?: '미니멀형' | '콜라주형'
  profile_image?: string
  portfolio_links?: PortfolioLink[]
  youtube_videos?: YouTubeVideo[]
  contact?: string
}

/**
 * 파일 업로드 응답 타입
 */
export interface FileUploadResponse {
  success: boolean
  url?: string
  error?: string
  originalName?: string
  size?: number
  type?: string
}

/**
 * 아티스트 권한 체크 결과 타입
 */
export interface ArtistPermissionCheck {
  hasPermission: boolean
  artist?: DatabaseArtist
  role?: 'owner' | 'manager' | 'collaborator'
  error?: string
}

// === 유틸리티 타입 정의 ===

/**
 * 아티스트 요약 정보 타입 (목록 표시용)
 */
export type ArtistSummaryDB = Pick<DatabaseArtist, 'id' | 'legacy_id' | 'slug' | 'name' | 'category' | 'profile_photo_url' | 'profile_photo_metadata' | 'one_liner' | 'template_type'>

/**
 * 멤버 프로필 요약 정보 타입
 */
export type MemberProfileSummary = Pick<MemberProfile, 'id' | 'display_name' | 'email' | 'is_artist' | 'artist_id' | 'artist_role' | 'registration_status' | 'is_active'>

/**
 * 마이페이지 메뉴 아이템 타입
 */
export interface MypageMenuItem {
  id: string
  label: string
  href: string
  icon?: React.ComponentType<{ className?: string }>
  requiredPermission?: 'member' | 'artist' | 'admin'
  badge?: string | number
  isActive?: boolean
}

// === 타입 가드 함수 정의 ===

/**
 * MemberProfile 타입 가드
 */
export function isMemberProfile(obj: any): obj is MemberProfile {
  return typeof obj === 'object' &&
    typeof obj.id === 'string' &&
    typeof obj.display_name === 'string' &&
    typeof obj.email === 'string' &&
    typeof obj.registration_status === 'string' &&
    typeof obj.is_active === 'boolean' &&
    typeof obj.is_artist === 'boolean'
}

/**
 * DatabaseArtist 타입 가드
 */
export function isDatabaseArtist(obj: any): obj is DatabaseArtist {
  return typeof obj === 'object' &&
    typeof obj.id === 'string' &&
    typeof obj.legacy_id === 'string' &&
    typeof obj.slug === 'string' &&
    typeof obj.name === 'string' &&
    Array.isArray(obj.category) &&
    typeof obj.template_type === 'string'
}

/**
 * 아티스트 권한 체크 함수 타입
 */
export type ArtistPermissionChecker = (
  memberProfile: MemberProfile,
  artistId: string
) => Promise<ArtistPermissionCheck>

// === 멤버 상태 관리 시스템 타입 정의 ===

/**
 * 멤버 상태 변경 이력 인터페이스
 */
export interface MemberStatusHistory {
  /** 고유 식별자 */
  id: string
  /** 대상 멤버 ID */
  member_id: string
  /** 변경 수행자 ID */
  changed_by?: string
  /** 수행된 액션 */
  action: 'approve' | 'reject' | 'activate' | 'deactivate' | 'suspend' | 'unsuspend' | 'promote' | 'demote' | 'update'
  /** 이전 상태 */
  previous_status: any
  /** 새로운 상태 */
  new_status: any
  /** 변경 사유 */
  reason?: string
  /** 추가 메타데이터 */
  metadata: any
  /** 생성일시 */
  created_at: string
  /** IP 주소 */
  ip_address?: string
  /** 사용자 에이전트 */
  user_agent?: string
  /** 변경 수행자 정보 (조인된 데이터) */
  changed_by_member?: {
    display_name: string
    email: string
  }
}

/**
 * 멤버 로그인 이력 인터페이스
 */
export interface MemberLoginHistory {
  /** 고유 식별자 */
  id: string
  /** 멤버 ID */
  member_id: string
  /** 로그인 일시 */
  login_at: string
  /** IP 주소 */
  ip_address?: string
  /** 사용자 에이전트 */
  user_agent?: string
  /** 로그인 성공 여부 */
  success: boolean
  /** 실패 사유 */
  failure_reason?: string
}

/**
 * 대량 작업 인터페이스
 */
export interface MemberBulkOperation {
  /** 고유 식별자 */
  id: string
  /** 작업 타입 */
  operation_type: 'bulk_approve' | 'bulk_reject' | 'bulk_activate' | 'bulk_deactivate' | 'bulk_suspend' | 'bulk_export'
  /** 수행자 ID */
  performed_by: string
  /** 대상 멤버 ID 목록 */
  member_ids: string[]
  /** 작업 파라미터 */
  parameters: any
  /** 작업 결과 */
  results: any
  /** 작업 상태 */
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
  /** 생성일시 */
  created_at: string
  /** 시작일시 */
  started_at?: string
  /** 완료일시 */
  completed_at?: string
  /** 오류 메시지 */
  error_message?: string
  /** 수행자 정보 (조인된 데이터) */
  performed_by_member?: {
    display_name: string
    email: string
  }
}

/**
 * 멤버 통계 인터페이스
 */
export interface MemberStatistics {
  /** 전체 멤버 수 */
  totalMembers: number
  /** 활성 멤버 수 */
  activeMembers: number
  /** 비활성 멤버 수 */
  inactiveMembers: number
  /** 승인 대기 멤버 수 */
  pendingMembers: number
  /** 승인된 멤버 수 */
  approvedMembers: number
  /** 거부된 멤버 수 */
  rejectedMembers: number
  /** 정지된 멤버 수 */
  suspendedMembers: number
  /** 아티스트 수 */
  artistMembers: number
  /** 관리자 수 */
  adminMembers: number
  /** 월별 가입 통계 */
  monthlyRegistrations: {
    month: string
    count: number
  }[]
  /** 멤버십 타입별 분포 */
  membershipTypeDistribution: {
    regular: number
    premium: number
    lifetime: number
  }
  /** 평균 프로필 완성도 */
  averageProfileCompleteness: number
  /** 평균 참여도 점수 */
  averageEngagementScore: number
}

/**
 * 대량 작업 요청 인터페이스
 */
export interface BulkOperationRequest {
  /** 작업 타입 */
  operation_type: 'bulk_approve' | 'bulk_reject' | 'bulk_activate' | 'bulk_deactivate' | 'bulk_suspend'
  /** 대상 멤버 ID 목록 */
  member_ids: string[]
  /** 작업 파라미터 */
  parameters?: {
    /** 정지 사유 (정지 작업 시) */
    suspension_reason?: string
    /** 정지 기간 (임시 정지 시) */
    suspension_until?: string
    /** 기타 메타데이터 */
    metadata?: any
  }
}

/**
 * 멤버 액션 타입
 */
export type MemberAction = 'approve' | 'reject' | 'activate' | 'deactivate' | 'suspend' | 'unsuspend' | 'promote' | 'demote'

/**
 * 멤버 필터 옵션
 */
export interface MemberFilterOptions {
  /** 등록 상태 필터 */
  registration_status?: 'pending' | 'approved' | 'rejected' | 'all'
  /** 활성 상태 필터 */
  is_active?: boolean
  /** 정지 상태 필터 */
  is_suspended?: boolean
  /** 아티스트 여부 필터 */
  is_artist?: boolean
  /** 관리자 여부 필터 */
  is_admin?: boolean
  /** 멤버십 타입 필터 */
  membership_type?: 'regular' | 'premium' | 'lifetime'
  /** 가입일 범위 필터 */
  date_range?: {
    start: string
    end: string
  }
  /** 최소 프로필 완성도 */
  min_profile_completeness?: number
  /** 최소 참여도 점수 */
  min_engagement_score?: number
  /** 검색 키워드 */
  search?: string
  /** 정렬 기준 */
  sort_by?: 'created_at' | 'updated_at' | 'last_login_at' | 'display_name' | 'engagement_score'
  /** 정렬 순서 */
  sort_order?: 'asc' | 'desc'
}

// === 상수 정의 ===

/**
 * 아티스트 역할 상수
 */
export const ARTIST_ROLES = {
  OWNER: 'owner',
  MANAGER: 'manager',
  COLLABORATOR: 'collaborator'
} as const

/**
 * 템플릿 타입 상수
 */
export const TEMPLATE_TYPES = {
  MINIMAL: '미니멀형',
  COLLAGE: '콜라주형'
} as const

/**
 * 파일 업로드 제한 상수
 */
export const FILE_UPLOAD_LIMITS = {
  MAX_SIZE: 5 * 1024 * 1024, // 5MB
  ACCEPTED_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
  MAX_PORTFOLIO_LINKS: 10,
  MAX_YOUTUBE_VIDEOS: 20
} as const
