/**
 * 텍스트 처리 유틸리티 함수들
 * HTML 태그 제거, 이미지 정보 추출 등의 기능 제공
 */

/**
 * HTML 태그를 제거하고 순수 텍스트만 추출
 * @param html HTML 문자열
 * @returns 태그가 제거된 순수 텍스트
 */
export const stripHtmlTags = (html: string): string => {
  if (typeof html !== 'string') {
    return String(html)
  }

  // HTML 태그 제거
  const withoutTags = html.replace(/<[^>]*>/g, '')

  // HTML 엔티티 디코딩
  const decoded = withoutTags
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#x60;/g, '`')
    .replace(/&#x3D;/g, '=')
    .replace(/&nbsp;/g, ' ')

  // 연속 공백 및 줄바꿈 정리
  return decoded.replace(/\s+/g, ' ').trim()
}

/**
 * HTML에서 이미지 정보 추출
 * @param html HTML 문자열
 * @returns 이미지 정보 객체
 */
export const extractImageInfo = (html: string) => {
  if (typeof html !== 'string') {
    return {
      hasImages: false,
      imageCount: 0,
      firstImageSrc: null,
    }
  }

  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
  const matches: string[] = []
  let match

  while ((match = imgRegex.exec(html)) !== null) {
    matches.push(match[1])
  }

  return {
    hasImages: matches.length > 0,
    imageCount: matches.length,
    firstImageSrc: matches[0] || null,
  }
}

/**
 * 텍스트 미리보기 생성
 * HTML 태그를 제거하고 지정된 길이로 자르며, 이미지 정보도 함께 반환
 * @param html HTML 문자열
 * @param maxLength 최대 길이 (기본값: 150)
 * @returns 미리보기 텍스트와 이미지 정보
 */
export const createTextPreview = (html: string, maxLength: number = 150) => {
  const cleanText = stripHtmlTags(html)
  const imageInfo = extractImageInfo(html)

  const isTextTruncated = cleanText.length > maxLength
  const previewText = isTextTruncated ? `${cleanText.substring(0, maxLength)}...` : cleanText

  return {
    text: previewText,
    isTruncated: isTextTruncated,
    originalLength: cleanText.length,
    ...imageInfo,
  }
}

/**
 * HTML에서 링크 정보 추출
 * @param html HTML 문자열
 * @returns 링크 정보 객체
 */
export const extractLinkInfo = (html: string) => {
  if (typeof html !== 'string') {
    return {
      hasLinks: false,
      linkCount: 0,
      links: [],
    }
  }

  const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi
  const links: Array<{ url: string; text: string }> = []
  let match

  while ((match = linkRegex.exec(html)) !== null) {
    links.push({
      url: match[1],
      text: match[2] || match[1],
    })
  }

  return {
    hasLinks: links.length > 0,
    linkCount: links.length,
    links,
  }
}
