/**
 * 프로젝트 관련 유틸리티 함수들
 */

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

  const lines = description
    .split('\n')
    .map(line => line.trim())
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
  const titleWords = title.toLowerCase().split(/\s+/)

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
export function getProjectSummary(
  project: { title: string; description: string; summary?: string },
  maxLength: number = 120
): string {
  // 커스텀 summary가 있으면 우선 사용
  if (project.summary) {
    return project.summary.length <= maxLength
      ? project.summary
      : project.summary.substring(0, maxLength) + '...'
  }

  // 없으면 스마트 추출
  return extractMeaningfulSummary(project.description, project.title, maxLength)
}
