import { NextRequest, NextResponse } from 'next/server'
import { apiGet, apiPost, ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { requireBoardMember } from '@/lib/server/boardRoomAuth'
import { BOARD_DOCUMENT_CATEGORIES } from '@/constants/boardRoom'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const auth = await requireBoardMember()
  if (auth instanceof NextResponse) return auth
  const { db, user } = auth
  const category = new URL(request.url).searchParams.get('category')

  return apiGet(
    async () => {
      let query = db
        .from('board_documents')
        .select('id, title, category, file_url, file_name, file_size, mime_type, uploaded_by, created_at')
        .order('created_at', { ascending: false })
      if (category && (BOARD_DOCUMENT_CATEGORIES as readonly string[]).includes(category)) {
        query = query.eq('category', category)
      }
      const { data, error } = await query
      if (error) throw ApiError.internalServerError('서류 목록을 불러올 수 없습니다.')
      return ApiSuccess.ok({ documents: data })
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
      const body = await request.json()
      const title: string = (body.title || '').trim()
      const category: string = body.category
      const fileUrl: string = body.file_url
      if (!title) throw ApiError.badRequest('제목을 입력해주세요.')
      if (!(BOARD_DOCUMENT_CATEGORIES as readonly string[]).includes(category)) throw ApiError.badRequest('잘못된 분류입니다.')
      if (!fileUrl) throw ApiError.badRequest('업로드된 파일이 없습니다.')

      const { data: doc, error } = await db
        .from('board_documents')
        .insert({
          title,
          category,
          file_url: fileUrl,
          file_name: body.file_name || null,
          file_size: body.file_size || null,
          mime_type: body.mime_type || null,
          uploaded_by: user.id,
        })
        .select('id')
        .single()
      if (error || !doc) throw ApiError.internalServerError('서류 등록에 실패했습니다.')
      return ApiSuccess.created({ id: doc.id }, '서류가 등록되었습니다.')
    },
    '/api/board-room/documents',
    { userId: user.id }
  )
}
