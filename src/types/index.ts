/**
 * 중앙화된 타입 정의 시스템
 * 모든 타입스크립트 인터페이스와 타입 정의를 중앙에서 관리
 */

// === 핵심 데이터 타입 정의 ===

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

/**
 * 링크 프리뷰 정보
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
  /** 페이지 URL */
  url: string
  /** 파비콘 URL */
  favicon?: string
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