/**
 * URL을 마크다운 링크 형식으로 변환
 * @param text 변환할 텍스트
 * @returns URL이 마크다운 링크로 변환된 텍스트
 */
export const convertUrlsToMarkdownLinks = (text: string): string => {
  const urlRegex = /(https?:\/\/[^\s]+)/g
  return text.replace(urlRegex, url => {
    // 이미 마크다운 링크 형식이면 그대로 반환
    if (/\[.*\]\(.*\)/.test(url)) return url
    // 일반 URL은 마크다운 링크로 변환
    return `[${url}](${url})`
  })
}
