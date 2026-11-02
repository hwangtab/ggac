import { z } from 'zod'
import { formatDateTime } from '@work/lib/format/datetime'

/**
 * 상태 메시지 — work.staff.status_emoji / status_text / status_until(0027).
 * 만료는 조회 시 필터(크론 없음): status_until 이 null 이거나 지금보다 미래면 유효하다.
 * 가시 범위는 staff_select(0026)를 그대로 따른다(게스트는 공동 멤버만) — 이 모듈은 가시성을 다루지 않는다.
 */
export const STATUS_TEXT_MAX = 80
export const STATUS_EMOJI_MAX = 16

export const STATUS_EXPIRY_OPTIONS = ['30m', '1h', '4h', 'today', 'week', 'never'] as const
export type StatusExpiry = (typeof STATUS_EXPIRY_OPTIONS)[number]

/**
 * 저장된 만료 시각을 그대로 둔다는 선택(다시 열어 문구만 고칠 때). 서버는 status_until 을 건드리지 않는다.
 * 선택지로만 쓰고 resolveStatusUntil 에는 넘기지 않는다.
 */
export const STATUS_EXPIRY_KEEP = 'keep' as const
export type StatusExpiryChoice = StatusExpiry | typeof STATUS_EXPIRY_KEEP

export const STATUS_EXPIRY_LABEL: Record<StatusExpiry, string> = {
  '30m': '30분',
  today: '오늘까지',
  '1h': '1시간',
  '4h': '4시간',
  week: '이번 주',
  never: '지우지 않음',
}

/** 자주 쓰는 상태(빠른 선택) */
export const STATUS_PRESETS: readonly { emoji: string; text: string; expiry: StatusExpiry }[] = [
  { emoji: '📅', text: '회의 중', expiry: '1h' },
  { emoji: '🍚', text: '점심 식사', expiry: '1h' },
  { emoji: '🚗', text: '이동 중', expiry: '4h' },
  { emoji: '🌴', text: '휴가 중', expiry: 'week' },
  { emoji: '🏠', text: '재택 근무', expiry: 'today' },
]

const codePoints = (s: string) => Array.from(s).length
const EMOJI_RE =
  /^[\p{Extended_Pictographic}\p{Regional_Indicator}\u200d\ufe0f\u20e3\p{Emoji_Modifier}\u{E0020}-\u{E007F}]+$/u

export const statusInputSchema = z
  .object({
    emoji: z
      .string()
      .trim()
      .refine(v => v === '' || (codePoints(v) <= STATUS_EMOJI_MAX && EMOJI_RE.test(v)), {
        message: '이모지를 하나만 골라 주세요.',
      }),
    text: z
      .string()
      .trim()
      .refine(v => codePoints(v) <= STATUS_TEXT_MAX, {
        message: `상태 문구는 ${STATUS_TEXT_MAX}자까지 쓸 수 있습니다.`,
      }),
    expiry: z.enum([...STATUS_EXPIRY_OPTIONS, STATUS_EXPIRY_KEEP]),
  })
  .refine(v => v.emoji !== '' || v.text !== '', {
    message: '이모지나 문구 중 하나는 입력해 주세요.',
  })

export type StatusInput = z.input<typeof statusInputSchema>

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** 만료 선택 → status_until(ISO). never 는 null. 오늘·이번 주 끝은 Asia/Seoul 기준 23:59:59.999. */
export function resolveStatusUntil(expiry: StatusExpiry, now: Date = new Date()): string | null {
  switch (expiry) {
    case 'never':
      return null
    case '30m':
      return new Date(now.getTime() + 30 * 60 * 1000).toISOString()
    case '1h':
      return new Date(now.getTime() + 60 * 60 * 1000).toISOString()
    case '4h':
      return new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString()
    case 'today':
    case 'week': {
      const kst = now.getTime() + KST_OFFSET_MS
      const dayStartKst = Math.floor(kst / DAY_MS) * DAY_MS
      const dow = new Date(kst).getUTCDay() // 0=일
      const daysToSunday = expiry === 'week' ? (7 - dow) % 7 : 0
      const endKst = dayStartKst + (daysToSunday + 1) * DAY_MS - 1
      return new Date(endKst - KST_OFFSET_MS).toISOString()
    }
  }
}

export type StatusFields = {
  status_emoji: string | null
  status_text: string | null
  status_until: string | null
}

export type ActiveStatus = { emoji: string | null; text: string | null; until: string | null }

/** 지금 유효한 상태(없거나 만료면 null). */
export function activeStatus(
  row: Partial<StatusFields> | null | undefined,
  now: Date = new Date()
): ActiveStatus | null {
  if (!row) return null
  const emoji = row.status_emoji?.trim() || null
  const text = row.status_text?.trim() || null
  if (!emoji && !text) return null
  if (row.status_until && new Date(row.status_until).getTime() <= now.getTime()) return null
  return { emoji, text, until: row.status_until ?? null }
}

/** "🌴 휴가 중" 한 줄(툴팁·목록용). */
export function statusLine(status: ActiveStatus | null): string {
  if (!status) return ''
  return [status.emoji, status.text].filter(Boolean).join(' ')
}

/** 다시 열었을 때 처음 보여 줄 만료 선택 — 저장된 시각이 있으면 유지(다시 저장해도 시각이 바뀌지 않는다), 없으면 지우지 않음. */
export function initialStatusExpiry(current: ActiveStatus | null): StatusExpiryChoice {
  if (!current) return 'today'
  return current.until ? STATUS_EXPIRY_KEEP : 'never'
}

/** "사용자 지정 시각까지 · 14:30" (오늘이 아니면 "10월 29일 14:30", 다른 해면 연도 포함). Asia/Seoul. */
export function keepExpiryLabel(until: string, now: Date = new Date()): string {
  return `사용자 지정 시각까지 · ${formatDateTime(until, now)}`
}
