/**
 * 파일 상세 썸네일의 "종이" 미리보기용 글 — 변환 결과(Markdown)나 텍스트 원문에서 앞부분만 평문으로 뽑는다.
 * 썸네일은 읽으라고 두는 것이 아니라 "어떤 문서인지" 알아보게 하는 것이라, 서식은 버리고 줄만 남긴다.
 * (클라이언트·서버 공용 순수 함수 — 렌더러를 쓰지 않으므로 raw HTML 이 그려질 일도 없다)
 */

/** 썸네일에 담는 최대 글자 수 — 패널 썸네일 칸에 들어가는 분량보다 넉넉하게 */
export const THUMB_TEXT_MAX_CHARS = 1200
/** 썸네일에 담는 최대 줄 수 */
export const THUMB_TEXT_MAX_LINES = 24

/** Markdown 한 줄을 평문으로 — 머리표·강조·링크·그림·표 구분선을 걷어낸다 */
function plainLine(line: string): string | null {
  let s = line
  if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(s)) return null // 표 구분선(줄 자체를 뺀다)
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // 그림 → 대체 글
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // 링크 → 글
  s = s.replace(/^\s{0,3}#{1,6}\s+/, '') // 제목 표시
  s = s.replace(/^\s{0,3}>\s?/, '') // 인용
  s = s.replace(/^\s*([-*+]|\d+[.)])\s+/, '· ') // 목록
  s = s.replace(/(\*\*|__|~~|`)/g, '') // 굵게·취소선·코드
  s = s.replace(/<[^>]+>/g, '') // 혹시 섞인 태그
  if (s.includes('|')) {
    s = s
      .split('|')
      .map(c => c.trim())
      .filter(Boolean)
      .join('  ')
  }
  return s.replace(/\s+$/, '')
}

/**
 * 앞부분 평문 줄 목록. 빈 줄이 이어지면 하나로 줄이고, 앞뒤 빈 줄은 뺀다.
 * markdown=false 면 원문(텍스트 파일)으로 보고 서식 제거를 하지 않는다.
 */
export function thumbnailLines(source: string, opts: { markdown?: boolean } = {}): string[] {
  const markdown = opts.markdown ?? true
  const head = source.slice(0, THUMB_TEXT_MAX_CHARS * 2).replace(/\r\n?/g, '\n')
  const out: string[] = []
  let chars = 0
  for (const raw of head.split('\n')) {
    const line = markdown ? plainLine(raw) : raw.replace(/\s+$/, '')
    if (line === null) continue
    if (line.trim() === '') {
      if (out.length > 0 && out[out.length - 1] !== '') out.push('')
      continue
    }
    const room = THUMB_TEXT_MAX_CHARS - chars
    if (room <= 0) break
    const clipped = line.length > room ? line.slice(0, room) : line
    out.push(clipped)
    chars += clipped.length
    if (out.length >= THUMB_TEXT_MAX_LINES) break
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  return out
}
