import { NextRequest } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createClient } from '@supabase/supabase-js'
import { validateUUID } from '@/utils/validation'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const preferredRegion = 'icn1'

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params

  const uuidValidation = validateUUID(id, '게시글 ID')
  if (!uuidValidation.isValid) {
    return ApiError.badRequest(
      uuidValidation.errors[0] || '잘못된 게시글 ID 형식입니다.'
    ).toNextResponse()
  }
  const postId = uuidValidation.sanitized

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    return ApiError.internalServerError('Supabase not configured').toNextResponse()
  }

  const supabase = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data, error } = await supabase
    .from('posts')
    .select('content, content_format')
    .eq('id', postId)
    .eq('is_deleted', false)
    .single()

  if (error || !data) {
    if (error) console.error('[API] 게시글 내용 조회 실패:', error)
    return ApiError.notFound('게시글을 찾을 수 없습니다.').toNextResponse()
  }
  const response = ApiSuccess.ok({
    content: (data as any).content || '',
    content_format: (data as any).content_format || 'plain',
  }).toNextResponse()
  // 완전 공개 데이터(익명 열람 가능·개인화 없음) — /api/board/post/[id]와 동일하게
  // CDN이 흡수하도록 s-maxage+SWR. 수정 시에는 revalidateTag가 아닌 TTL(60s)로 수렴.
  response.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
  return response
}
