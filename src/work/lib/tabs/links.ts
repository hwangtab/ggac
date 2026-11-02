/**
 * 공유됨 > 링크(0025 work.message_links). 권한은 RLS(can_read_channel)가 정하고 채널 id 로 좁히기만 한다.
 * 링크 행에는 작성자가 없어 메시지·staff 를 한 번씩 더 읽는다(곁가지가 아니라 화면의 일부라 실패는 던진다).
 */

/** 링크 목록 한 화면에 보여 줄 최대 개수 */
export const LINKS_LIMIT = 100

export type LinkItem = {
  messageId: string
  url: string
  /** 공유된 시각(= 메시지 시각) */
  createdAt: string
  authorName: string | null
  /** 그 링크가 든 메시지로 가는 주소(스레드 답글이면 ?thread=) */
  messageHref: string
}

export type ChannelLinks = { items: LinkItem[]; total: number }

/** 호스트 이름(www. 제거). 파싱 실패 시 빈 문자열 */
export function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return ''
  }
}

/** 호스트 뒤의 경로·쿼리를 짧게(80자) — 목록에서 주소 모양을 알아볼 정도만 */
export function linkPathLabel(url: string, max = 80): string {
  try {
    const u = new URL(url)
    const rest = `${u.pathname === '/' ? '' : u.pathname}${u.search}`
    let decoded = rest
    try {
      decoded = decodeURIComponent(rest)
    } catch {
      // 잘못된 % 인코딩은 원문 그대로
    }
    return decoded.length > max ? `${decoded.slice(0, max - 1)}…` : decoded
  } catch {
    return ''
  }
}
