/**
 * 프로젝트 관련 유틸리티 함수들
 */

/**
 * 문자열을 메타데이터용으로 안전하게 정리
 * 마크다운 문법을 제거하고 plain text로 변환
 */
export function stripMarkdown(str: string, options: { preserveLineBreaks?: boolean } = {}): string {
  if (!str) return ''

  const text = str
    // 마크다운 제목 제거 (### 제목, ## 제목, # 제목)
    .replace(/^#{1,6}\s+/gm, '')
    // 강조 문법 제거 (**텍스트**, __텍스트__)
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    // 이탤릭 제거 (*텍스트*, _텍스트_) - 강조 제거 후 처리
    .replace(/(\*|_)(.*?)\1/g, '$2')
    // 링크 제거 [텍스트](url) -> 텍스트만 남김
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // 이미지 제거 ![alt](url) -> 빈 문자열
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    // 인라인 코드 제거 `code` -> code
    .replace(/`([^`]+)`/g, '$1')
    // 리스트 마커 제거 (-, *, +, 숫자.)
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // 제어 문자 제거
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')

  if (options.preserveLineBreaks) {
    return text
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  return text.replace(/\s+/g, ' ').trim()
}

function sanitizeForMetadata(str: string): string {
  return stripMarkdown(str)
}

/**
 * 프로젝트 설명에서 의미있는 요약을 추출하는 함수
 * 형식적인 문구나 제목 반복을 건너뛰고 실제 내용을 찾아서 반환
 */
export function extractMeaningfulSummary(
  description: string,
  title: string,
  maxLength: number = 120
): string {
  if (!description) return ''

  // 입력 문자열을 안전하게 정리
  const safeDescription = sanitizeForMetadata(description)
  const safeTitle = sanitizeForMetadata(title)

  const lines = safeDescription
    .split('\n')
    .map(line => sanitizeForMetadata(line))
    .filter(line => line.length > 0)

  // 건너뛸 패턴들
  const skipPatterns = [
    /^수신:\s*/,
    /^제목:\s*/,
    /^귀하의 건승을/,
    /^아래와 같이/,
    /^- 다 음 -/,
    /^공연명:\s*/,
    /^### /,
    /^\*\*/,
    /^- \*/,
  ]

  // 제목과 유사한 줄도 건너뛰기
  const titleWords = safeTitle.toLowerCase().split(/\s+/)

  for (const line of lines) {
    // 건너뛸 패턴 체크
    if (skipPatterns.some(pattern => pattern.test(line))) {
      continue
    }

    // 제목과 너무 유사한 줄 건너뛰기
    const lineWords = line.toLowerCase().split(/\s+/)
    const titleSimilarity =
      titleWords.filter(word => lineWords.includes(word)).length / titleWords.length
    if (titleSimilarity > 0.7) {
      continue
    }

    // 너무 짧은 줄 건너뛰기
    if (line.length < 20) {
      continue
    }

    // 의미있는 내용을 찾았으면 적절한 길이로 자르기
    if (line.length <= maxLength) {
      return line
    }

    // 문장 단위로 자르기 시도
    const sentences = line.split(/[.!?。]/).filter(s => s.trim().length > 0)
    if (sentences.length > 0) {
      let summary = sentences[0].trim()

      // 여러 문장을 합쳐서 maxLength에 맞추기
      for (let i = 1; i < sentences.length; i++) {
        const nextSentence = sentences[i].trim()
        if (summary.length + nextSentence.length + 2 <= maxLength) {
          summary += '. ' + nextSentence
        } else {
          break
        }
      }

      return summary.length > 0 ? summary : line.substring(0, maxLength) + '...'
    }

    return line.substring(0, maxLength) + '...'
  }

  // 의미있는 내용을 찾지 못했으면 첫 번째 줄 반환 (기존 동작)
  return lines[0] || ''
}

/**
 * 프로젝트의 요약을 가져오는 함수
 * 커스텀 summary가 있으면 우선 사용, 없으면 스마트 추출
 */
/**
 * 카드 요약·메타데이터에서 이모지를 걷어낸다.
 *
 * 게시물 본문(description)은 조합원이 직접 쓴 원문이라 그대로 두지만, 그
 * 첫 줄이 카드 요약과 og:description으로 그대로 올라오면서 🪩🎸📦 같은
 * 글자가 포스터 타이포그래피 자리에 박혔다. 본문에서는 살리고 요약에서만 뺀다.
 */
function stripDisplayEmoji(value: string): string {
  return value
    .replace(
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu,
      ''
    )
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function getProjectSummary(
  project: { title: string; description: string; summary?: string },
  maxLength: number = 120
): string {
  try {
    // 입력값 유효성 검사
    if (!project || typeof project !== 'object') {
      return '경기아트콜렉티브 프로젝트'
    }

    const safeTitle = sanitizeForMetadata(project.title || '')
    const safeDescription = stripMarkdown(project.description || '', { preserveLineBreaks: true })
    const safeSummary = project.summary ? sanitizeForMetadata(project.summary) : ''

    // 커스텀 summary가 있으면 우선 사용
    if (safeSummary) {
      const clean = stripDisplayEmoji(safeSummary)
      return clean.length <= maxLength ? clean : clean.substring(0, maxLength) + '...'
    }

    // 없으면 스마트 추출
    const extracted = extractMeaningfulSummary(safeDescription, safeTitle, maxLength)
    return stripDisplayEmoji(extracted) || '경기아트콜렉티브 프로젝트'
  } catch (error) {
    console.error('Error in getProjectSummary:', error)
    return '경기아트콜렉티브 프로젝트'
  }
}
