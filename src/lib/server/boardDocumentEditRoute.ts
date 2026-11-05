import { NextRequest, NextResponse } from 'next/server'
import {
  getBoardDocumentForEdit,
  type BoardDocumentEditRow,
} from '@/db/queries/boardDocumentVersions'
import { boardDocumentEditAccess } from '@/lib/boardDocuments/editRules'
import { applyRateLimit, RATE_LIMITS } from '@/lib/server/rateLimit'
import { ApiError } from '@/utils/apiWrapper'

/**
 * 이사회 서류 앱 편집 API(`/api/board-room/documents/[id]/edit-uploads`·`/versions`·`/versions/[versionId]/download`)가
 * 게이트 **다음에** 같이 쓰는 단계 — docs/board-work/05-이사회-서류-앱-편집.md §4.
 *
 * 순서는 늘 같다: ① 라우트 첫 줄 `requireBoardMember()`(비로그인 401 · 조합원·미승인 403 — 정적 가드가 문자열로
 * 못박는다) ② 경로 id 모양(UUID 가 아니면 404) ③ 쓰기면 `limitBoardDocumentEdit()` ④ 서류 행 + 판정
 * (`editableBoardDocumentOr()` — 없거나 이사회에도 안 보이는 등급이면 404, 올린 사람·관리자가 아니면 403).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

/** 404 — 없는 것·안 보이는 것을 가리지 않는다(존재를 알리지 않는다) */
export function boardDocumentNotFound(message = '서류를 찾을 수 없습니다.'): NextResponse {
  return ApiError.notFound(message).toNextResponse()
}

/**
 * 서류 행을 읽고 편집 판정까지 한다. 고칠 수 있으면 행, 아니면 404/403 응답. 조회 실패는 500.
 * `requireBoardMember()`를 지난 사람의 `userId`·`isAdmin`만 넘긴다.
 */
export async function editableBoardDocumentOr(
  id: string,
  userId: string,
  isAdmin: boolean
): Promise<BoardDocumentEditRow | NextResponse> {
  let doc: BoardDocumentEditRow | null
  try {
    doc = await getBoardDocumentForEdit(id)
  } catch {
    return ApiError.internalServerError('서류를 불러올 수 없습니다.').toNextResponse()
  }
  const access = boardDocumentEditAccess(doc, userId, isAdmin)
  if (access === 'not_found') return boardDocumentNotFound()
  if (access === 'forbidden') {
    return ApiError.forbidden(
      '이 서류를 고칠 권한이 없습니다. 올린 사람이나 관리자만 고칠 수 있습니다.'
    ).toNextResponse()
  }
  return doc as BoardDocumentEditRow
}

const LIMIT_URL = 'https://board-documents.internal/edit'

/**
 * 사용자 단위 분산 레이트 리밋 — 쓰기(BOARD_DOCUMENT_EDIT_WRITE 분당 30)·편집기 저장본 검사(BOARD_DOCUMENT_EDIT_VERIFY
 * 분당 10). 키는 사용자 id(게이트를 지난 뒤라 신원이 확정돼 있다). 넘으면 429 응답, 아니면 null. 쓰기라 리미터 장애 때 닫힌다.
 * 내 문서함(`limitMemberDocumentWrite`)과 같은 모양이다.
 */
export async function limitBoardDocumentEdit(
  userId: string,
  kind: 'write' | 'verify' = 'write'
): Promise<NextResponse | null> {
  const config =
    kind === 'verify'
      ? RATE_LIMITS.BOARD_DOCUMENT_EDIT_VERIFY
      : RATE_LIMITS.BOARD_DOCUMENT_EDIT_WRITE
  const limiter = await applyRateLimit({
    ...config,
    keyGenerator: () => `rate_limit:${config.name}:${userId}`,
  })
  const result = await limiter(new NextRequest(LIMIT_URL, { method: 'POST' }))
  if (result.success) return null
  return ApiError.tooManyRequests(config.message).toNextResponse()
}
