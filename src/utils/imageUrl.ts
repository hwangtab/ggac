/**
 * 이미지 URL 생성 및 SNS 메타데이터용 이미지 처리 유틸리티
 */

import { toSafeHttpUrl, toSafeInternalImagePath } from './safeUrl'

export interface ImageUrlOptions {
  /** 기본 이미지 경로 (상대 경로 또는 절대 URL) */
  imagePath?: string | null
  /** 대체 이미지 경로들 (우선순위 순) */
  fallbackPaths?: (string | null)[]
  /** SNS 공유용으로 변환할지 여부 (WebP -> JPG 변환) */
  forSocialSharing?: boolean
  /** 절대 URL로 변환할지 여부 */
  absolute?: boolean
  /** 기본 도메인 (절대 URL 생성시 사용) */
  baseUrl?: string
}

/**
 * SNS 공유에 최적화된 이미지 URL 생성
 * WebP 이미지를 JPG로 변환하고, 절대 URL로 반환
 */
export function generateSocialImageUrl(
  imagePath?: string | null,
  options: Omit<ImageUrlOptions, 'forSocialSharing' | 'absolute'> = {}
): string {
  return generateImageUrl(imagePath, {
    ...options,
    forSocialSharing: true,
    absolute: true,
  })
}

/**
 * 프로젝트용 OG 이미지 URL 생성
 * 1. coverImage 우선 사용
 * 2. 갤러리 첫 번째 이미지 사용
 * 3. 기본 로고 이미지 사용
 */
export function generateProjectOgImage(project: {
  coverImage?: string | null
  gallery?: string[]
}): string {
  const fallbacks = [project.coverImage, project.gallery?.[0], '/images/logo/gac_og.webp']

  return generateSocialImageUrl(null, {
    fallbackPaths: fallbacks,
  })
}

/**
 * 게시글용 OG 이미지 URL 생성
 * 첨부 이미지가 있으면 사용, 없으면 기본 로고 사용
 */
export function generatePostOgImage(thumbnail?: string | null): string {
  const fallbacks = [thumbnail, '/images/logo/gac_og.webp']

  return generateSocialImageUrl(null, {
    fallbackPaths: fallbacks,
  })
}

/**
 * 범용 이미지 URL 생성 함수
 */
export function generateImageUrl(imagePath?: string | null, options: ImageUrlOptions = {}): string {
  const { fallbackPaths = [], absolute = false, baseUrl = 'https://ggac.kr' } = options

  // 사용할 이미지 경로 결정 (우선순위: imagePath -> fallbackPaths -> 기본 로고)
  const allPaths = [imagePath, ...fallbackPaths, '/images/logo/gac_og.webp']
  const selectedPath =
    allPaths
      .map(path => normalizeImagePath(path))
      .find((path): path is string => typeof path === 'string' && path.length > 0) ||
    '/images/logo/gac_og.webp'

  if (selectedPath.startsWith('http://') || selectedPath.startsWith('https://')) {
    return selectedPath
  }

  if (absolute) {
    return `${baseUrl.replace(/\/$/, '')}${selectedPath}`
  }

  return selectedPath
}

function normalizeImagePath(imagePath?: string | null): string | null {
  if (!imagePath || imagePath.trim() === '') return null

  const trimmed = imagePath.trim()
  if (/^https?:\/\//i.test(trimmed)) {
    return toSafeHttpUrl(trimmed)
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return null
  }

  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return toSafeInternalImagePath(normalized, '') || null
}

/**
 * 이미지 경로가 유효한지 확인
 */
export function isValidImagePath(imagePath?: string | null): boolean {
  return normalizeImagePath(imagePath) !== null
}
