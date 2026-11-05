import { NextRequest, NextResponse } from 'next/server'
import { apiGet, apiPost, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { rateLimit } from '@/lib/server/rateLimit'
import {
  requireBoardMember,
  requireBoardRecordReader,
  visibilityScopeFor,
} from '@/lib/server/boardRoomAuth'
import {
  ALL_DOCUMENT_CATEGORIES,
  BOARD_DOCUMENT_CATEGORIES,
  canSetDocumentVisibility,
  isDocumentVisibility,
} from '@/constants/boardRoom'
import { createLogger } from '@/utils/logger'
import {
  hasBinaryNullBytes,
  hasKnownFileSignature,
  hasValidFileSignature,
} from '@/utils/fileUploadValidation'
import { deleteBoardDocument, putBoardDocument } from '@/lib/storage/privateProvider'
import { createDocument, documentFilePathExists, listDocuments } from '@/db/queries/board'
import { scheduleBoardDocumentTextExtraction } from '@work/lib/files/extract-schedule'
import {
  BOARD_DOCUMENT_MAX_FILE_SIZE,
  BOARD_DOCUMENT_TOO_LARGE_MESSAGE,
  BOARD_DOCUMENT_UNSUPPORTED_TYPE_MESSAGE,
  checkStoredBoardDocument,
  isAllowedBoardDocumentMime,
  sanitizeBoardDocumentFileName,
  validateBoardDocumentRegistration,
} from '@/lib/boardDocuments/uploadRules'
import {
  boardDocumentObjectPath,
  downloadBoardDocumentObject,
  removeBoardDocumentObjects,
  statBoardDocumentObject,
} from '@/lib/boardDocuments/storage'
import { limitBoardDocumentEdit } from '@/lib/server/boardDocumentEditRoute'
import { StorageUnconfiguredError } from '@work/lib/files/private-store'
import { parseJsonObjectBody } from '@/utils/requestBody'

const log = createLogger('boardRoom/documents')

export const runtime = 'nodejs'

// 크기 상한·허용 형식·파일 이름 정리는 브라우저 직접 업로드(`/uploads`)와 함께 쓴다 — `@/lib/boardDocuments/uploadRules`

export async function GET(request: NextRequest) {
  // 열람 게이트다. 조합원은 visibility='members' 자료만 받는다 — 관리자가
  // 그렇게 지정한 것만이다. 기본값은 'board'라, 지정하지 않은 자료(인감증명서·
  // 계좌 거래내역서 등)는 조합원 목록에서 아예 빠진다.
  const auth = await requireBoardRecordReader()
  if (auth instanceof NextResponse) return auth
  const { user, isBoardMember } = auth
  const visibility = visibilityScopeFor(isBoardMember)
  const category = new URL(request.url).searchParams.get('category')

  return apiGet(
    async () => {
      if (category && !(ALL_DOCUMENT_CATEGORIES as readonly string[]).includes(category)) {
        throw ApiError.badRequest('잘못된 분류입니다.')
      }

      let data: Awaited<ReturnType<typeof listDocuments>>
      try {
        // 카테고리가 없으면 원본과 동일하게 정기총회 자료를 제외한다(별도
        // '정기총회' 메뉴에서 관리). 제외(`!=`) 대신 **허용 목록**으로 넘기는
        // 이유: `!=`는 idx_board_documents_category를 타지 못해 서류함 기본
        // 조회가 매번 전체 스캔이었다. `ALL_DOCUMENT_CATEGORIES =
        // BOARD_DOCUMENT_CATEGORIES + ASSEMBLY_DOCUMENT_CATEGORY`라
        // (constants/boardRoom.ts) 아래 목록은 '총회 제외'와 정확히 같은 집합이다
        // — 카테고리를 새로 만들면 이 상수에 함께 넣어야 목록에서 사라지지 않는다.
        data = await listDocuments(
          category
            ? { category, visibility }
            : { categories: BOARD_DOCUMENT_CATEGORIES, visibility },
          {
            onTruncated: ({ limit }) =>
              log.error('서류 목록이 상한에 걸려 잘렸다 — 페이지네이션이 필요하다', { limit }),
          }
        )
      } catch {
        throw ApiError.internalServerError('서류 목록을 불러올 수 없습니다.')
      }

      // 서명 URL을 만들지 않는다. 만료되지 않는 내부 경로만 내려주고, 권한은
      // 다운로드 시점에 매번 검사한다. 이 변경으로 uploaded_by가 NULL인 시드
      // 문서 14건의 다운로드도 함께 되살아난다 — 예전 경로 가드가 file_path와
      // uploaded_by의 접두어 일치를 요구해 전부 막고 있었다.
      const documents = data.map(doc => {
        const { file_path, ...rest } = doc
        return {
          ...rest,
          download_url: `/api/board-room/documents/${doc.id}/download`,
        }
      })

      return ApiSuccess.ok({ documents })
    },
    '/api/board-room/documents',
    { userId: user.id }
  )
}

function isJsonRequest(request: NextRequest): boolean {
  return (request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')
}

/**
 * POST /api/board-room/documents — 서류 등록. 두 갈래다:
 *  - **JSON**(`content-type: application/json`) — 화면이 쓰는 길. 브라우저가 `/uploads`로 비공개 저장소에 직접 올린 뒤
 *    `{ filePath, fileName, title, category, visibility }`만 보낸다(Vercel 함수 본문 4.5MB 한도를 지나지 않는다).
 *  - **multipart**(`file` 칸) — 예전 길. 4.5MB 아래 파일과 권한 E2E·스크립트가 그대로 쓴다.
 */
export async function POST(request: NextRequest) {
  if (isJsonRequest(request)) return registerUploadedDocument(request)

  // 문서 업로드 남용 방지 (전수감사 안정성 M-4)
  const rl = await rateLimit(request, 'FILE_UPLOAD')
  if (!rl.success) {
    return rl.response ?? ApiError.tooManyRequests('요청이 너무 많습니다.').toNextResponse()
  }

  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { user, isAdmin } = auth

  return apiPost(
    async () => {
      const formData = await request.formData()
      const file = formData.get('file') as File | null
      const title = ((formData.get('title') as string) || '').trim()
      const category = (formData.get('category') as string) || ''
      const rawVisibility = formData.get('visibility')
      const visibility = rawVisibility == null ? 'board' : String(rawVisibility)

      // Validate fields
      if (!title) throw ApiError.badRequest('제목을 입력해주세요.')
      if (!(ALL_DOCUMENT_CATEGORIES as readonly string[]).includes(category))
        throw ApiError.badRequest('잘못된 분류입니다.')
      if (!isDocumentVisibility(visibility)) throw ApiError.badRequest('잘못된 열람 범위입니다.')
      // 업로드 자체는 이사·감사·관리자 모두 가능(requireBoardMember)하지만,
      // 조합원 전체 공개(visibility='members')는 관리자만 정할 수 있다(설계
      // 문서 §6 권한 표). 기본값 'board'는 이사도 그대로 통과한다.
      if (!canSetDocumentVisibility(visibility, isAdmin)) {
        throw ApiError.forbidden(
          '조합원 전체 공개(visibility=members)는 관리자만 설정할 수 있습니다. 기본값인 이사회 열람으로 올려주세요.'
        )
      }
      if (!file) throw ApiError.badRequest('업로드된 파일이 없습니다.')
      if (file.size > BOARD_DOCUMENT_MAX_FILE_SIZE)
        throw ApiError.badRequest(BOARD_DOCUMENT_TOO_LARGE_MESSAGE)
      if (!isAllowedBoardDocumentMime(file.type))
        throw ApiError.badRequest(BOARD_DOCUMENT_UNSUPPORTED_TYPE_MESSAGE)

      // Build safe storage path
      const safeName = sanitizeBoardDocumentFileName(file.name)
      const storagePath = `${user.id}/${Date.now()}_${safeName}`

      // Upload to private bucket via service-role client
      const buffer = Buffer.from(await file.arrayBuffer())
      if (hasKnownFileSignature(file.type) && !hasValidFileSignature(buffer, file.type)) {
        throw ApiError.badRequest('파일 내용이 선언된 파일 형식과 일치하지 않습니다.')
      }
      if (file.type === 'text/plain' && hasBinaryNullBytes(buffer)) {
        throw ApiError.badRequest('텍스트 파일 내용이 올바르지 않습니다.')
      }

      try {
        await putBoardDocument(storagePath, buffer, file.type)
      } catch (uploadError) {
        log.error('storage upload 실패', {
          error: uploadError instanceof Error ? uploadError.message : String(uploadError),
        })
        throw ApiError.internalServerError('파일 업로드에 실패했습니다.')
      }

      // Insert metadata row
      let doc: { id: string }
      try {
        doc = await createDocument({
          title,
          category,
          filePath: storagePath,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          uploadedBy: user.id,
          visibility,
        })
      } catch (insertError) {
        log.error('메타데이터 삽입 실패', {
          error: insertError instanceof Error ? insertError.message : String(insertError),
        })
        // Rollback: remove just-uploaded storage object
        try {
          await deleteBoardDocument(storagePath)
        } catch (removeErr) {
          log.error('rollback 삭제 실패', {
            error: removeErr instanceof Error ? removeErr.message : String(removeErr),
          })
        }
        throw ApiError.internalServerError('서류 등록에 실패했습니다.')
      }

      // 업무 검색이 파일 속 글자도 찾도록 본문 추출을 예약한다(03 §10). 응답 뒤에 돌고 던지지 않는다 —
      // 실패해도 업로드는 성공이고, 추출 크론이 최신 순으로 따라잡는다.
      scheduleBoardDocumentTextExtraction([doc.id])

      return ApiSuccess.created({ id: doc.id }, '서류가 등록되었습니다.')
    },
    '/api/board-room/documents',
    { userId: user.id }
  )
}

/**
 * JSON 등록 — 브라우저가 `/api/board-room/documents/uploads`로 올린 객체를 서류 행으로 만든다.
 *
 * 순서: requireBoardMember(비로그인 401·조합원 403) → 사용자 단위 쓰기 한도(올리기 한 번은 준비 단계가 `FILE_UPLOAD`로
 * 이미 셌다) → 입력(제목·분류·열람 범위 — 조합원 공개는 관리자만, 경로는 **내 폴더**만) → 이미 쓰는 경로면 409(지우지
 * 않는다 — 남의 행의 파일이다) → 객체 메타(없으면 409 · 크기·형식이 어긋나면 지우고 400) → 앞머리 서명·텍스트 널 바이트
 * (어긋나면 지우고 400) → 행 삽입(실패하면 객체를 되돌린다) → 본문 추출 예약.
 */
async function registerUploadedDocument(request: NextRequest): Promise<NextResponse> {
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { user, isAdmin } = auth
  const limited = await limitBoardDocumentEdit(user.id)
  if (limited) return limited

  return apiPost(
    async () => {
      const body = await parseJsonObjectBody(request)
      if (!body) throw ApiError.badRequest('유효한 JSON body가 필요합니다.')
      const input = validateBoardDocumentRegistration(user.id, isAdmin, body)
      if (input.ok === false) throw new ApiError(input.error, input.status)
      const { filePath, fileName, title, category, visibility } = input.data
      const pathname = boardDocumentObjectPath(filePath)

      let exists: boolean
      try {
        exists = await documentFilePathExists(filePath)
      } catch {
        throw ApiError.internalServerError('서류 등록에 실패했습니다.')
      }
      if (exists) throw new ApiError('이미 등록된 파일입니다.', 409)

      const discard = async () => {
        try {
          await removeBoardDocumentObjects([pathname])
        } catch (removeErr) {
          log.error('거절한 업로드 객체 삭제 실패', {
            error: removeErr instanceof Error ? removeErr.name : String(removeErr),
          })
        }
      }

      let meta: Awaited<ReturnType<typeof statBoardDocumentObject>>
      try {
        meta = await statBoardDocumentObject(pathname)
      } catch (e) {
        if (e instanceof StorageUnconfiguredError) {
          throw ApiError.serviceUnavailable('파일 저장소가 설정되지 않았습니다.')
        }
        log.error('업로드 객체 확인 실패', { error: e instanceof Error ? e.name : String(e) })
        throw ApiError.serviceUnavailable(
          '파일 저장소에 닿지 못했습니다. 잠시 후 다시 시도해 주세요.'
        )
      }
      if (!meta) {
        throw new ApiError('올린 파일을 찾을 수 없습니다. 파일을 다시 올려 주세요.', 409)
      }
      const stored = checkStoredBoardDocument(meta)
      if (stored.ok === false) {
        await discard()
        throw ApiError.badRequest(stored.error)
      }
      const { size, mime } = stored.data

      let buffer: Buffer
      try {
        buffer = await downloadBoardDocumentObject(pathname)
      } catch (e) {
        log.error('업로드 객체 읽기 실패', { error: e instanceof Error ? e.name : String(e) })
        throw ApiError.serviceUnavailable(
          '파일 저장소에 닿지 못했습니다. 잠시 후 다시 시도해 주세요.'
        )
      }
      if (hasKnownFileSignature(mime) && !hasValidFileSignature(buffer, mime)) {
        await discard()
        throw ApiError.badRequest('파일 내용이 선언된 파일 형식과 일치하지 않습니다.')
      }
      if (mime === 'text/plain' && hasBinaryNullBytes(buffer)) {
        await discard()
        throw ApiError.badRequest('텍스트 파일 내용이 올바르지 않습니다.')
      }

      let doc: { id: string }
      try {
        doc = await createDocument({
          title,
          category,
          filePath,
          fileName,
          fileSize: size,
          mimeType: mime,
          uploadedBy: user.id,
          visibility,
        })
      } catch (insertError) {
        log.error('메타데이터 삽입 실패', {
          error: insertError instanceof Error ? insertError.message : String(insertError),
        })
        await discard()
        throw ApiError.internalServerError('서류 등록에 실패했습니다.')
      }

      // 업무 검색이 파일 속 글자도 찾도록 본문 추출을 예약한다(03 §10) — multipart 분기와 같다
      scheduleBoardDocumentTextExtraction([doc.id])

      return ApiSuccess.created({ id: doc.id }, '서류가 등록되었습니다.')
    },
    '/api/board-room/documents',
    { userId: user.id }
  )
}
