import { NextRequest, NextResponse } from 'next/server'
import { apiGet, apiPost, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { rateLimit } from '@/lib/server/rateLimit'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import { ALL_DOCUMENT_CATEGORIES, BOARD_DOCUMENT_CATEGORIES } from '@/constants/boardRoom'
import { createLogger } from '@/utils/logger'
import {
  hasBinaryNullBytes,
  hasKnownFileSignature,
  hasValidFileSignature,
} from '@/utils/fileUploadValidation'
import { deleteBoardDocument, putBoardDocument } from '@/lib/storage/privateProvider'
import { createDocument, listDocuments } from '@/db/queries/board'

const log = createLogger('boardRoom/documents')

export const runtime = 'nodejs'

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/haansofthwp',
  'application/x-hwp',
  'text/plain',
])

/** Strip path separators and unusual chars; keep alnum, dash, underscore, dot */
function sanitizeFileName(name: string): string {
  const sanitized = name
    .replace(/[/\\]/g, '_')
    .replace(/[^a-zA-Z0-9._\-가-힣]/g, '_')
    .replace(/^\.+/, '')
  return sanitized || 'file'
}

export async function GET(request: NextRequest) {
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { user } = auth
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
          category ? { category } : { categories: BOARD_DOCUMENT_CATEGORIES },
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

export async function POST(request: NextRequest) {
  // 문서 업로드 남용 방지 (전수감사 안정성 M-4)
  const rl = await rateLimit(request, 'FILE_UPLOAD')
  if (!rl.success) {
    return rl.response ?? ApiError.tooManyRequests('요청이 너무 많습니다.').toNextResponse()
  }

  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  return apiPost(
    async () => {
      const formData = await request.formData()
      const file = formData.get('file') as File | null
      const title = ((formData.get('title') as string) || '').trim()
      const category = (formData.get('category') as string) || ''

      // Validate fields
      if (!title) throw ApiError.badRequest('제목을 입력해주세요.')
      if (!(ALL_DOCUMENT_CATEGORIES as readonly string[]).includes(category))
        throw ApiError.badRequest('잘못된 분류입니다.')
      if (!file) throw ApiError.badRequest('업로드된 파일이 없습니다.')
      if (file.size > MAX_FILE_SIZE) throw ApiError.badRequest('파일 크기는 최대 50MB입니다.')
      if (!ALLOWED_MIME_TYPES.has(file.type))
        throw ApiError.badRequest(
          `지원하지 않는 파일 형식입니다. 허용 형식: PDF, 이미지, Word, Excel, 한글(HWP), 텍스트`
        )

      // Build safe storage path
      const safeName = sanitizeFileName(file.name)
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

      return ApiSuccess.created({ id: doc.id }, '서류가 등록되었습니다.')
    },
    '/api/board-room/documents',
    { userId: user.id }
  )
}
