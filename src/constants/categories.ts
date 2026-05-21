/**
 * 카테고리 정의 중앙화
 * 언어별로 구분하여 사용자 경험 일관성 유지
 */

// 아카이브 프로젝트 카테고리 (공개, 국제적 - 영문 All 사용)
export const ARCHIVE_CATEGORIES = [
  'All',
  '음반·음원',
  '공연·전시',
  '예술교육',
  '지원·용역사업',
  '행사',
] as const

export type ArchiveCategory = (typeof ARCHIVE_CATEGORIES)[number]

// 아티스트 카테고리 (공개, 국제적 - 영문 All 사용)
export const ARTIST_CATEGORIES = [
  'All',
  '기획자',
  '사운드 디자이너',
  '엔지니어',
  '연주자',
  '작곡가',
  '작사가',
  '창작자',
  '편곡가',
  '프로듀서',
] as const

export type ArtistCategory = (typeof ARTIST_CATEGORIES)[number]

// 게시판 카테고리 (멤버 전용, 친밀한 분위기 - 한글 전체 사용)
export const BOARD_CATEGORIES = ['전체', '공지', '잡담', '홍보', '건의'] as const

export type BoardCategory = (typeof BOARD_CATEGORIES)[number]

// 카테고리별 스타일 매핑 (게시글 카드 꾸밈용)
export const BOARD_CATEGORY_STYLES = {
  공지: 'bg-red-100 text-red-800',
  잡담: 'bg-blue-100 text-blue-800',
  홍보: 'bg-green-100 text-green-800',
  건의: 'bg-yellow-100 text-yellow-800',
} as const

// 카테고리 그룹 통합 (타입 안정성을 위해)
export const CATEGORIES = {
  ARCHIVE: {
    ALL: 'All' as const,
    ITEMS: ARCHIVE_CATEGORIES.slice(1), // 'All'을 제외한 실제 카테고리들
  },
  ARTISTS: {
    ALL: 'All' as const,
    ITEMS: ARTIST_CATEGORIES.slice(1),
  },
  BOARD: {
    ALL: '전체' as const,
    ITEMS: BOARD_CATEGORIES.slice(1),
  },
} as const

// 영어 표시 라벨 맵 (canonical 한글 값 → 영어 라벨)
export const ARCHIVE_CATEGORY_LABELS_EN: Record<string, string> = {
  All: 'All',
  '음반·음원': 'Music',
  '공연·전시': 'Performance & Exhibition',
  '예술교육': 'Arts Education',
  '지원·용역사업': 'Grants & Services',
  '행사': 'Event',
}

export const ARTIST_CATEGORY_LABELS_EN: Record<string, string> = {
  All: 'All',
  '기획자': 'Organizer',
  '사운드 디자이너': 'Sound Designer',
  '엔지니어': 'Engineer',
  '연주자': 'Performer',
  '작곡가': 'Composer',
  '작사가': 'Lyricist',
  '창작자': 'Creator',
  '편곡가': 'Arranger',
  '프로듀서': 'Producer',
  '기타': 'Other',
}

export function localizeArchiveCategory(value: string, locale: string): string {
  if (locale !== 'en') return value
  return ARCHIVE_CATEGORY_LABELS_EN[value] ?? value
}

export function localizeArtistCategory(value: string, locale: string): string {
  if (locale !== 'en') return value
  return ARTIST_CATEGORY_LABELS_EN[value] ?? value
}

// 카테고리 유효성 검사 헬퍼 함수들
export const isValidArchiveCategory = (category: string): category is ArchiveCategory => {
  return ARCHIVE_CATEGORIES.includes(category as ArchiveCategory)
}

export const isValidArtistCategory = (category: string): category is ArtistCategory => {
  return ARTIST_CATEGORIES.includes(category as ArtistCategory)
}

export const isValidBoardCategory = (category: string): category is BoardCategory => {
  return BOARD_CATEGORIES.includes(category as BoardCategory)
}
