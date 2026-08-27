/**
 * 시각을 따로 정하지 않은 회의의 기본 시각.
 *
 * 예전에는 이 값이 **모든** 이사회의 시각이었다(`BOARD_MEETING_TIME`, 항상
 * 밤 9시 고정). 그래서 오후에 모인 회의는 화면에 21:00으로 찍히고, 실제
 * 시각은 장소 뒤에 `· 오후 3시`처럼 손으로 덧붙이는 관행이 생겼다. 이제
 * 시각은 `board_meetings.meeting_time`에 회의별로 저장되고, 이 상수는
 * 그 값이 비어 있을 때(= 과거에 만들어진 회의 전부) 쓰는 기본값이다.
 */
export const DEFAULT_BOARD_MEETING_TIME = '21:00' as const
export const MAX_BOARD_MEETING_CANDIDATE_DATES = 30
export const MAX_BOARD_AGENDA_SORT_ORDER = 10000

export const BOARD_MEETING_STATUS = ['polling', 'scheduled', 'completed'] as const
export type BoardMeetingStatus = (typeof BOARD_MEETING_STATUS)[number]

export const BOARD_AGENDA_STATUS = ['proposed', 'discussed', 'resolved'] as const
export type BoardAgendaStatus = (typeof BOARD_AGENDA_STATUS)[number]

// 일반 서류함 카테고리 (조합 기본 서류)
export const BOARD_DOCUMENT_CATEGORIES = ['등록증', '정관', '계약', '기타'] as const
export type BoardDocumentCategory = (typeof BOARD_DOCUMENT_CATEGORIES)[number]

// 정기총회 전용 카테고리 — 일반 서류함과 분리된 '정기총회' 메뉴에서만 사용
export const ASSEMBLY_DOCUMENT_CATEGORY = '총회' as const

// DB CHECK 제약(chk_board_document_category)과 일치하는 전체 허용 카테고리
export const ALL_DOCUMENT_CATEGORIES = [
  ...BOARD_DOCUMENT_CATEGORIES,
  ASSEMBLY_DOCUMENT_CATEGORY,
] as const
export type AnyDocumentCategory = (typeof ALL_DOCUMENT_CATEGORIES)[number]

/** `HH:MM`(24시간) 형식만 통과시킨다. 그 밖에는 `null`. */
export function parseBoardMeetingTime(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(trimmed)) return null

  return trimmed
}

/**
 * 저장된 시각이 없으면 기본값으로 떨어진다. `meeting_time`이 NULL인 과거
 * 회의를 화면에서 시각 없이 보이게 두지 않으려는 것 — 그 회의들은 실제로
 * 전부 21:00이었다.
 */
export function resolveBoardMeetingTime(value: string | null | undefined): string {
  return parseBoardMeetingTime(value) ?? DEFAULT_BOARD_MEETING_TIME
}

export function parseBoardMeetingDate(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null

  const parsed = new Date(`${trimmed}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime())) return null

  return parsed.toISOString().startsWith(trimmed) ? trimmed : null
}

export function parseBoardMeetingDeadline(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed) return null

  const parsed = new Date(trimmed)
  if (!Number.isFinite(parsed.getTime())) return null

  return parsed.toISOString()
}

export function parseBoardMeetingCandidateDates(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null

  const dates = value.map(parseBoardMeetingDate)
  if (dates.some(date => !date)) return null

  const uniqueDates = [...new Set(dates as string[])]
  if (uniqueDates.length === 0 || uniqueDates.length > MAX_BOARD_MEETING_CANDIDATE_DATES) {
    return null
  }

  return uniqueDates
}

export function parseBoardAgendaSortOrder(value: unknown): number | null {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_BOARD_AGENDA_SORT_ORDER
  ) {
    return null
  }

  return value
}
