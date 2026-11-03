import { NextResponse } from 'next/server'
import { visibilityScopeFor } from '@/lib/server/boardRoomAuth'
import { isSafeBoardDocumentFilePath } from '@/lib/storage/boardDocuments'
import { getBoardDocumentStream } from '@/lib/storage/privateProvider'
import { getDocumentForPreview, type DocumentPreviewRow } from '@/db/queries/board'
import { jsonError, NO_STORE } from './file-response'

/**
 * 자료실의 '이사회 서류' 미리보기 라우트(`/api/board-room/work/board-documents/<id>…`, 03 §10) 공용 — 서버 전용.
 *
 * 서류는 옮기지 않는다: 행은 `board_documents`, 바이트는 비공개 저장소 `board-documents/<owner>/<file>`(서류함·
 * 정기총회와 같은 곳)다. 각 라우트는 첫 줄에서 `requireBoardMember()`를 부르고(정적 가드가 요구한다) 이 모듈은 그 뒤의
 * 공통 단계다:
 * - 서류 행을 읽고 **자료 등급을 다시 본다**(`visibilityScopeFor(true)` — 기존 다운로드 라우트와 같은 모양). 지금은 게이트가
 *   이사·감사·관리자뿐이라 늘 통과하지만, 게이트가 넓어져도 이 판정이 'board' 자료를 지킨다.
 * - 저장 경로는 DB 행에서만 오고 `isSafeBoardDocumentFilePath`를 통과해야 한다(같은 저장소에 DB 백업이 있다).
 * 권한 밖·없음·위험한 경로는 모두 404다(존재 여부를 알리지 않는다).
 */
export type BoardDocumentSource = DocumentPreviewRow & { name: string; size: number; mime: string }

export async function boardDocumentOr404(id: string): Promise<BoardDocumentSource | NextResponse> {
  let doc: DocumentPreviewRow | null
  try {
    doc = await getDocumentForPreview(id)
  } catch (e) {
    console.error('[board-work/board-documents] 서류 조회 실패:', e)
    return jsonError(500, 'Server Error')
  }
  if (!doc) return jsonError(404, 'Not Found')
  if (!visibilityScopeFor(true).includes(doc.visibility)) return jsonError(404, 'Not Found')
  if (!isSafeBoardDocumentFilePath(doc.file_path)) {
    console.error('[board-work/board-documents] 안전하지 않은 서류 경로 차단', { id })
    return jsonError(404, 'Not Found')
  }
  return {
    ...doc,
    name: doc.file_name?.trim() || doc.title,
    size: doc.file_size ?? 0,
    mime: doc.mime_type ?? '',
  }
}

/** 기존 다운로드 라우트(`/api/board-room/documents/<id>/download` — 매 요청 권한 재검사)로 보낸다 */
export function redirectToDownload(id: string, requestUrl: string): NextResponse {
  return NextResponse.redirect(new URL(`/api/board-room/documents/${id}/download`, requestUrl), {
    status: 302,
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

/** 저장소 스트림. 없으면 null — 라우트가 404로 바꾼다 */
export async function boardDocumentStream(doc: BoardDocumentSource) {
  const object = await getBoardDocumentStream(doc.file_path)
  return object?.stream ? object : null
}

/** 원본 전체(변환용). 크기 상한은 호출자가 행 크기로 먼저 보고, 여기서 실제 바이트로 한 번 더 막는다 */
export async function readBoardDocumentBytes(
  doc: BoardDocumentSource,
  maxBytes: number
): Promise<Buffer> {
  const object = await boardDocumentStream(doc)
  if (!object?.stream) throw new Error('서류 파일이 없습니다')
  const buffer = Buffer.from(await new Response(object.stream).arrayBuffer())
  if (buffer.length > maxBytes) throw new Error('서류 파일이 너무 큽니다')
  return buffer
}
