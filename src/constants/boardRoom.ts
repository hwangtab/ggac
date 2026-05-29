export const BOARD_MEETING_TIME = '21:00' as const // 이사회 시각은 항상 밤 9시 고정

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
