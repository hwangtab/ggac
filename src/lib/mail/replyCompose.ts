/**
 * 받은 메일에 답장할 때의 받는 사람·제목·인용 — 화면(미리보기)과 답장 라우트(실제 발송)가 같은 함수를 쓴다.
 * 화면이 보여 준 받는 사람과 실제로 나가는 받는 사람이 달라지면 안 되기 때문이다. 서버가 판정의 정본이다.
 *
 * 다른 모듈은 확장자까지 붙여 들여온다 — `node --test` 타입 스트리핑 제약.
 */

import { COMPOSE_LIMITS, isTestRecipientAddress, normalizeAddress } from './composeValidation.ts'

export type ReplySource = {
  from_address: string
  /** JSON 문자열 또는 객체. `reply-to`만 본다. */
  headers?: unknown
  /** JSON 배열 문자열 또는 배열. */
  to_addresses?: unknown
  cc_addresses?: unknown
  /** 이 메일을 받은 **우리** 주소. 전체 답장에서 뺀다. */
  received_for?: unknown
}

export type ReplyRecipients = {
  to: string
  cc: string[]
  /** 전체 답장 후보였지만 뺀 주소 — 형식이 틀렸거나 참조 상한을 넘었다. 화면이 알린다. */
  dropped: string[]
  /** 일일 한도에 셀 수. `@test.local`은 실제로 나가지 않으므로 세지 않는다(새 메일 작성과 같은 규칙). */
  recipientCount: number
}

/**
 * 헤더 한 칸에서 주소를 **적힌 순서대로** 모두 뽑는다 — `이름 <a@b>, c@d` 꼴. 따옴표 이름은 먼저 지워 쉼표·`@`가 든
 * 이름(`"Kim, M" <a@b>`)도 견딘다. 순서가 중요하다 — `Reply-To`의 첫 주소가 받는 사람이 된다.
 */
function extractAddresses(text: string): string[] {
  const unquoted = text.replace(/"[^"]*"/g, ' ')
  const pattern = /<([^<>\s]+@[^<>\s]+)>|([^\s<>,;"()]+@[^\s<>,;"()]+)/g
  return [...unquoted.matchAll(pattern)].map(match => match[1] ?? match[2])
}

function jsonList(value: unknown): string[] {
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      return []
    }
  }
  return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : []
}

function replyToHeader(headers: unknown): string {
  let parsed = headers
  if (typeof headers === 'string') {
    try {
      parsed = JSON.parse(headers)
    } catch {
      return ''
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return ''
  const entry = Object.entries(parsed as Record<string, unknown>).find(
    ([key]) => key.toLowerCase() === 'reply-to'
  )
  const value = entry?.[1]
  return Array.isArray(value)
    ? value.map(String).join(', ')
    : typeof value === 'string'
      ? value
      : ''
}

/**
 * 답장 받는 사람. `Reply-To`가 있으면 그 첫 주소, 없으면 보낸 사람이다 — 메일링 서비스·대리 발송은 회신 주소를
 * 따로 적는데, 그것을 무시하면 답장이 아무도 읽지 않는 주소로 간다. 받는 사람이 올바른 주소가 아니면 null.
 *
 * `all`(전체 답장)이면 원본의 받는 사람·참조와 `Reply-To`의 나머지 주소를 참조로 넣는다. 이 메일을 받은 우리
 * 주소(`received_for`, 서버는 허용 수신 주소도 `ownAddresses`로 더한다)와 받는 사람 자신은 뺀다.
 */
export function replyRecipients(
  source: ReplySource,
  options: { all: boolean; ownAddresses?: string[] }
): ReplyRecipients | null {
  const replyTo = extractAddresses(replyToHeader(source.headers))
  const fromCandidates = extractAddresses(String(source.from_address ?? ''))
  const to = normalizeAddress(replyTo[0] ?? fromCandidates[0] ?? '')
  if (!to) return null

  const own = new Set(
    [...jsonList(source.received_for), ...(options.ownAddresses ?? [])]
      .flatMap(extractAddresses)
      .map(address => address.trim().toLowerCase())
  )
  const cc: string[] = []
  const dropped: string[] = []
  if (options.all) {
    const candidates = [
      ...replyTo.slice(1),
      ...jsonList(source.to_addresses).flatMap(extractAddresses),
      ...jsonList(source.cc_addresses).flatMap(extractAddresses),
    ]
    const seen = new Set([to])
    for (const raw of candidates) {
      const lowered = raw.trim().toLowerCase()
      if (own.has(lowered) || seen.has(lowered)) continue
      seen.add(lowered)
      const address = normalizeAddress(raw)
      if (!address || cc.length >= COMPOSE_LIMITS.maxCc) {
        dropped.push(lowered)
        continue
      }
      cc.push(address)
    }
  }
  const recipientCount = [to, ...cc].filter(address => !isTestRecipientAddress(address)).length
  return { to, cc, dropped, recipientCount }
}

/** `Re: `를 한 번만 붙인다. 이미 `Re:`·`RE:`·`회신:`으로 시작하면 그대로 둔다. */
export function replySubject(original: string | null | undefined): string {
  const subject = String(original ?? '').trim() || '(제목 없음)'
  return /^(re|회신)\s*:/i.test(subject) ? subject : `Re: ${subject}`
}

/** 인용할 원문 길이 상한. 넘으면 자르고 생략 표시를 단다 — 긴 스레드가 통째로 되돌아가지 않게. */
export const QUOTE_MAX_CHARS = 20_000

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 답장 끝에 붙일 원문 인용(HTML). **평문(`body_text`)만** 인용한다 — 받은 HTML은 외부에서 온 것이라 우리 이름으로
 * 다시 내보내지 않는다(추적 픽셀·스크립트 잔재가 우리 메일에 실려 나간다). 평문이 없으면 인용하지 않는다(null).
 */
export function buildReplyQuote(source: {
  from_address: string
  received_at: string | Date | null
  body_text: string | null | undefined
}): string | null {
  const text = String(source.body_text ?? '').trim()
  if (!text) return null
  const clipped =
    text.length > QUOTE_MAX_CHARS ? `${text.slice(0, QUOTE_MAX_CHARS)}\n…(이하 생략)` : text
  const at = source.received_at ? new Date(source.received_at) : null
  const when =
    at && !Number.isNaN(at.getTime())
      ? at.toLocaleString('ko-KR', {
          timeZone: 'Asia/Seoul',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : null
  const who = String(source.from_address ?? '').trim()
  const lead = `${when ? `${when}, ` : ''}${who} 님이 작성:`
  return (
    `<br><br><div>${escapeHtml(lead)}</div>` +
    `<blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">` +
    `${escapeHtml(clipped).replace(/\r?\n/g, '<br>')}</blockquote>`
  )
}
