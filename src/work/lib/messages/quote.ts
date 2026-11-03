import { toPlainText } from '@work/lib/search/text'
import { decodeMentions } from './mentions'
import type { ChatMessage } from './types'

/**
 * 인용 답장(0028) 표시 규칙(순수). 입력창 위 미리보기와 메시지 위 인용 카드가 같이 쓴다.
 */

export const QUOTE_PREVIEW_LINES = 2
const QUOTE_LINE_MAX_CHARS = 120

/** 마크다운 장식을 걷어 낸 한 줄(카드는 서식 없이 보인다): 인용 `>`·제목 `#`·목록 기호 */
function plainLine(line: string): string {
  return line
    .replace(/^\s*(?:>\s*)+/, '')
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 줄 단위 평문: 장식 기호 제거 후 인라인 마크다운(굵게·백틱·링크)을 걷는다 */
function plainPreviewLine(line: string): string {
  return toPlainText(plainLine(line))
}

/** 본문 앞 N줄(빈 줄 제외, 멘션 토큰은 `@이름`). 본문이 없으면 빈 배열 */
export function quotePreviewLines(
  body: string,
  maxLines: number = QUOTE_PREVIEW_LINES
): { lines: string[]; truncated: boolean } {
  const all = decodeMentions(body)
    .text.replace(/```[\s\S]*?```/g, ' ')
    .split('\n')
    .map(plainPreviewLine)
    .filter(l => l.length > 0)
  const lines = all
    .slice(0, maxLines)
    .map(l => (l.length > QUOTE_LINE_MAX_CHARS ? `${l.slice(0, QUOTE_LINE_MAX_CHARS)}…` : l))
  const truncated =
    all.length > maxLines || all.slice(0, maxLines).some(l => l.length > QUOTE_LINE_MAX_CHARS)
  return { lines, truncated }
}

/**
 * 인용 카드 상태.
 * - none: 인용 아님
 * - ok: 원본을 볼 수 있다
 * - deleted: 원본이 삭제됨(소프트 삭제)
 * - unavailable: 원본을 읽을 수 없다(권한 없음·하드 삭제 — 임베드가 null)
 */
export type QuoteState = 'none' | 'ok' | 'deleted' | 'unavailable'

export function quoteState(message: Pick<ChatMessage, 'quoted_message_id' | 'quoted'>): QuoteState {
  if (!message.quoted_message_id) return 'none'
  if (!message.quoted) return 'unavailable'
  return message.quoted.deleted_at ? 'deleted' : 'ok'
}

export const QUOTE_UNAVAILABLE_TEXT = '원본 메시지를 볼 수 없습니다'
export const QUOTE_DELETED_TEXT = '삭제된 메시지입니다'

/** 입력창 위 미리보기가 들고 있는 인용 대상 */
export type QuoteTarget = {
  id: string
  authorId: string | null
  body: string
}

export function toQuoteTarget(
  message: Pick<ChatMessage, 'id' | 'author_id' | 'body'>
): QuoteTarget {
  return { id: message.id, authorId: message.author_id, body: message.body }
}
