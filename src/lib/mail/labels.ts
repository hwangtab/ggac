/**
 * 메일함 라벨 규칙 — 화면(고르기·미리 막기)과 라우트(판정)가 같이 쓴다. 로컬 import가 없어야 한다 — `node --test`
 * 타입 스트리핑 제약.
 */

/** 색 팔레트. 저장하는 값은 키이고, 화면은 이 표의 Tailwind 클래스로 그린다(임의의 색 문자열을 받지 않는다). */
export const MAIL_LABEL_COLORS = {
  gray: 'bg-gray-100 text-gray-700',
  red: 'bg-red-100 text-red-800',
  orange: 'bg-orange-100 text-orange-800',
  yellow: 'bg-yellow-100 text-yellow-800',
  green: 'bg-green-100 text-green-800',
  blue: 'bg-blue-100 text-blue-800',
  purple: 'bg-purple-100 text-purple-800',
  pink: 'bg-pink-100 text-pink-800',
} as const

export type MailLabelColor = keyof typeof MAIL_LABEL_COLORS

export const LABEL_NAME_MAX = 30
/** 라벨 개수 상한 — 분류가 늘어 거르기 칩이 화면을 덮지 않게. */
export const MAX_LABELS = 50

export function isMailLabelColor(value: unknown): value is MailLabelColor {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MAIL_LABEL_COLORS, value)
}

/** 이름 정규화 — 앞뒤 공백을 털고 안쪽 연속 공백은 하나로. 비었거나 길면 null. */
export function normalizeLabelName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.trim().replace(/\s+/g, ' ')
  if (!name || name.length > LABEL_NAME_MAX) return null
  return name
}

export function labelColorClass(color: string): string {
  return isMailLabelColor(color) ? MAIL_LABEL_COLORS[color] : MAIL_LABEL_COLORS.gray
}
