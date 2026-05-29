export const BOARD_MEETING_TIME = '21:00' as const // 이사회 시각은 항상 밤 9시 고정

export const BOARD_MEETING_STATUS = ['polling', 'scheduled', 'completed'] as const
export type BoardMeetingStatus = (typeof BOARD_MEETING_STATUS)[number]

export const BOARD_AGENDA_STATUS = ['proposed', 'discussed', 'resolved'] as const
export type BoardAgendaStatus = (typeof BOARD_AGENDA_STATUS)[number]

export const BOARD_DOCUMENT_CATEGORIES = ['등록증', '정관', '계약', '기타'] as const
export type BoardDocumentCategory = (typeof BOARD_DOCUMENT_CATEGORIES)[number]
