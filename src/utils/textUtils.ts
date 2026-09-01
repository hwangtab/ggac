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

  // HTML 태그 제거. 두 번째 replace는 닫는 '>'가 없는 후행 미완결 태그를 지운다 —
  // 목록 미리보기는 뷰의 left(content, 2000)로 본문을 자르는데, 그 경계가 태그
  // (특히 긴 base64 data URI가 든 <img>) 중간을 자르면 '<img src="data:...' 같은
  // 원시 조각이 미리보기에 노출되기 때문이다(코드리뷰 — 첫 replace는 미완결 태그를
  // 제거하지 못함).
  const withoutTags = html.replace(/<[^>]*>/g, '').replace(/<[^>]*$/, '')

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
 * 마크다운 문법 마커를 제거하고 순수 텍스트만 추출.
 *
 * `content_format === 'markdown'` 게시글의 목록 미리보기용 — 상세 페이지는
 * `PostContentRenderer.tsx`가 ReactMarkdown으로 렌더링해 문제없지만, 목록
 * 미리보기(`createTextPreview`)는 원문을 그대로 잘라 보여줘 `### `·
 * `[라벨](url)`·`\[`(이스케이프) 같은 마크다운 제어문자가 그대로 노출된다.
 * **호출부가 `content_format === 'markdown'`일 때만 이 함수를 써야 한다** —
 * 무조건 적용하면 `[x](y)`를 정당하게 쓰는 기존 평문 게시글을 조용히 고쳐 쓴다.
 *
 * 순서가 중요하다: 링크/이미지 문법을 이스케이프 해제보다 먼저 처리해야
 * `\[제목\]` 처럼 라벨 안에 이스케이프된 대괄호가 있어도(`grantDigest.ts`의
 * `escapeMarkdown`이 공고 제목에 흔한 `[…]` 말머리를 이렇게 만든다) 링크
 * 종료로 오인하지 않는다 — `(?:\\.|[^\]])*`가 `\]`를 escaped-char 한 쌍으로
 * 소비하고 지나간다.
 */
export const stripMarkdownSyntax = (markdown: string): string => {
  if (typeof markdown !== 'string') {
    return String(markdown)
  }

  return (
    markdown
      // ATX 헤딩 마커: 줄 시작의 '#' ~ '######' + 공백
      .replace(/^#{1,6}\s+/gm, '')
      // 수평선: 줄 전체가 -/*/_ 3개 이상으로만 이루어진 경우. 줄 끝은 [ \t]만
      // 허용한다(\s는 개행도 포함해 다음 빈 줄까지 집어삼킨다).
      .replace(/^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '')
      // 링크·이미지: [라벨](url) · ![대체텍스트](url) → 라벨/대체텍스트
      .replace(/!?\[((?:\\.|[^\]])*)\]\([^)]*\)/g, '$1')
      // 목록 마커: 줄 시작 '- '·'* '·'+ '·'1. '
      .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
      // 강조: **볼드**, __볼드__, *이탤릭*, _이탤릭_, `코드`
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(\*|_)(.+?)\1/g, '$2')
      .replace(/`([^`]*)`/g, '$1')
      // 이스케이프: \[ \] \* \_ \` \\ → 원래 문자 (링크 처리 이후에 풀어야 한다)
      .replace(/\\([\\`*_[\]])/g, '$1')
  )
}

/**
 * 텍스트 미리보기 생성
 * HTML 태그를 제거하고 지정된 길이로 자르며, 이미지 정보도 함께 반환
 * @param html HTML 문자열
 * @param maxLength 최대 길이 (기본값: 150)
 * @param contentFormat 'markdown'일 때만 마크다운 문법을 먼저 벗겨낸다. 그 외
 *   (undefined 포함)는 기존과 동일하게 HTML 태그 제거만 한다.
 * @returns 미리보기 텍스트와 이미지 정보
 */
export const createTextPreview = (
  html: string,
  maxLength: number = 150,
  contentFormat?: string
) => {
  const source = contentFormat === 'markdown' ? stripMarkdownSyntax(html) : html
  const cleanText = stripHtmlTags(source)
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
