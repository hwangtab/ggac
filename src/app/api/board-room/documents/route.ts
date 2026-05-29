import { NextRequest, NextResponse } from 'next/server'
import { apiGet, apiPost, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import { ALL_DOCUMENT_CATEGORIES, ASSEMBLY_DOCUMENT_CATEGORY } from '@/constants/boardRoom'
import { createLogger } from '@/utils/logger'

const log = createLogger('boardRoom/documents')

export const runtime = 'nodejs'

const BUCKET = 'board-documents'
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
  const { db, user } = auth
  const category = new URL(request.url).searchParams.get('category')

  return apiGet(
    async () => {
      let query = db
        .from('board_documents')
        .select(
          'id, title, category, file_path, file_name, file_size, mime_type, uploaded_by, created_at'
        )
        .order('created_at', { ascending: false })
      if (category) {
        if (!(ALL_DOCUMENT_CATEGORIES as readonly string[]).includes(category)) {
          throw ApiError.badRequest('잘못된 분류입니다.')
        }
        query = query.eq('category', category)
      } else {
        // 일반 서류함 전체 조회에는 정기총회 자료를 제외(별도 '정기총회' 메뉴에서 관리)
        query = query.neq('category', ASSEMBLY_DOCUMENT_CATEGORY)
      }
      const { data, error } = await query
      if (error) throw ApiError.internalServerError('서류 목록을 불러올 수 없습니다.')

      // Generate a 5-minute signed URL for each document; degrade gracefully on failure
      const documents = await Promise.all(
        (data || []).map(async doc => {
          const { data: signedData, error: signErr } = await db.storage
            .from(BUCKET)
            .createSignedUrl(doc.file_path, 300)
          if (signErr) {
            log.error('signed URL 생성 실패', { id: doc.id, error: signErr.message })
          }
          const { file_path, ...rest } = doc
          return {
            ...rest,
            download_url: signedData?.signedUrl ?? null,
          }
        })
      )

      return ApiSuccess.ok({ documents })
    },
    '/api/board-room/documents',
    { userId: user.id }
  )
}

export async function POST(request: NextRequest) {
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { db, user } = auth

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
      const bytes = new Uint8Array(await file.arrayBuffer())
      const { error: uploadError } = await db.storage.from(BUCKET).upload(storagePath, bytes, {
        contentType: file.type,
        upsert: false,
      })
      if (uploadError) {
        log.error('storage upload 실패', { error: uploadError.message })
        throw ApiError.internalServerError('파일 업로드에 실패했습니다.')
      }

      // Insert metadata row
      const { data: doc, error: insertError } = await db
        .from('board_documents')
        .insert({
          title,
          category,
          file_path: storagePath,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type,
          uploaded_by: user.id,
        })
        .select('id')
        .single()

      if (insertError || !doc) {
        // Rollback: remove just-uploaded storage object
        const { error: removeErr } = await db.storage.from(BUCKET).remove([storagePath])
        if (removeErr) {
          log.error('rollback 삭제 실패', { error: removeErr.message })
        }
        throw ApiError.internalServerError('서류 등록에 실패했습니다.')
      }

      return ApiSuccess.created({ id: doc.id }, '서류가 등록되었습니다.')
    },
    '/api/board-room/documents',
    { userId: user.id }
  )
}
