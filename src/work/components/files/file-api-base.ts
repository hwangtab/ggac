'use client'

import { createContext, useContext } from 'react'

/**
 * 미리보기 부품(FilePreviewBody·DocumentViewer)이 파일을 받아 오는 API 기준 경로. 기본은 업무툴 첨부
 * (`/api/board-room/work/files/<id>…`)이고, 자료실의 이사회 서류는 같은 부품을
 * `/api/board-room/work/board-documents/<id>…`로 돌린다(03 §10 — 라우트 모양 `<base>/<id>`·`/<name>`·`/render`가 같다).
 * 권한은 각 라우트가 요청마다 다시 판정한다 — 이 값은 주소만 고른다.
 */
export const WORK_FILE_API_BASE = '/api/board-room/work/files'
export const BOARD_DOCUMENT_API_BASE = '/api/board-room/work/board-documents'

export const FileApiBaseContext = createContext<string>(WORK_FILE_API_BASE)

export function useFileApiBase(): string {
  return useContext(FileApiBaseContext)
}
