export interface GlobalData {
  siteName: string
  siteDescription: string
  joinFormUrl: string
  contact: ContactInfo
  social: SocialInfo
  businessInfo: BusinessInfo
}

export interface ContactInfo {
  email: string
  phone: string
  address: string
}

export interface SocialInfo {
  instagram: string
  youtube: string
}

export interface BusinessInfo {
  establishedDate: string
  registrationDate: string
  registrationNumber: string
}

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  statusCode?: number
}

export type LoadingState = 'idle' | 'loading' | 'success' | 'error'

export interface PaginationInfo {
  currentPage: number
  totalPages: number
  pageSize: number
  totalItems: number
}

export interface SearchFilters {
  category?: string
  query?: string
  sortBy?: 'date' | 'name' | 'category'
  sortOrder?: 'asc' | 'desc'
}

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
  unoptimized?: boolean
  fallbackSources?: string[]
  loadTimeoutMs?: number
  errorTimeoutMs?: number
}

export interface FormValidationResult {
  isValid: boolean
  errors: Record<string, string>
  data?: any
}

export enum TemplateType {
  MINIMAL = '미니멀형',
  COLLAGE = '콜라주형',
}

export const DEFAULT_VALUES = {
  ARTISTS_PER_PAGE: 12,
  PROJECTS_PER_PAGE: 9,
  FEATURED_ARTISTS_COUNT: 6,
  FEATURED_PROJECTS_COUNT: 3,
  IMAGE_QUALITY: 85,
  CACHE_DURATION: 3600,
} as const

export const BREAKPOINTS = {
  SM: '640px',
  MD: '768px',
  LG: '1024px',
  XL: '1280px',
  '2XL': '1536px',
} as const
