import {
  ALL_DOCUMENT_CATEGORIES,
  ASSEMBLY_DOCUMENT_CATEGORY,
  type AnyDocumentCategory,
} from '@/constants/boardRoom'

/**
 * 자료실의 '이사회 서류' 묶음(03 §10 — 서류함 통합 (가)). 서류는 옮기지 않는다 — `board_documents` 행을 분류
 * (`category`)별 폴더로 보여 줄 뿐이다. 폴더 = 서류함 분류 4종 + 정기총회(총회). 분류를 새로 만들면
 * `ALL_DOCUMENT_CATEGORIES`(DB CHECK와 같은 목록)에 넣는 것으로 여기에도 생긴다.
 */
export const BOARD_FOLDERS: readonly AnyDocumentCategory[] = ALL_DOCUMENT_CATEGORIES

/** `?board=<분류>` — 목록에 있는 분류만 받는다(그 밖은 null → 평소 자료실) */
export function parseBoardFolder(raw: string | string[] | undefined): AnyDocumentCategory | null {
  const v = Array.isArray(raw) ? raw[0] : raw
  return (BOARD_FOLDERS as readonly string[]).includes(v ?? '') ? (v as AnyDocumentCategory) : null
}

/** 이사회 서류 폴더 주소(업무 경로 — `@work/lib/nav/link`가 `/board-room`을 붙인다). `doc`이면 그 서류 미리보기를 연다 */
export function boardFolderHref(category: string, docId?: string): string {
  const q = new URLSearchParams({ board: category })
  if (docId) q.set('doc', docId)
  return `/files?${q.toString()}`
}

export const BOARD_VISIBILITY_LABEL: Record<string, string> = {
  members: '조합원 공개',
  board: '이사회만',
}

/**
 * 이 폴더에 올릴 수 있는가 — 기존 화면 규칙을 그대로 옮긴다. 서류함 분류는 이사·감사·관리자 누구나(서버
 * `requireBoardMember`), 정기총회 자료는 정기총회 화면처럼 관리자만 올리는 단추를 보인다. 열람 범위를 '조합원 공개'로
 * 정하는 것은 관리자만이다(`canSetDocumentVisibility` — 서버가 다시 판정한다).
 */
export function canUploadToBoardFolder(category: string, isAdmin: boolean): boolean {
  return category === ASSEMBLY_DOCUMENT_CATEGORY ? isAdmin : true
}
