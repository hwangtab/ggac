import { NextRequest, NextResponse } from 'next/server'
import { createErrorResponse } from '@/utils/apiResponse'
import { createClient } from '@supabase/supabase-js'
import { validateUUID } from '@/utils/validation'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const preferredRegion = 'icn1'

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params

  const uuidValidation = validateUUID(id, '게시글 ID')
  if (!uuidValidation.isValid) {
    return NextResponse.json(
      { error: uuidValidation.errors[0] || '잘못된 게시글 ID 형식입니다.' },
      { status: 400 }
    )
  }
  const postId = uuidValidation.sanitized

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    return createErrorResponse({ success: false, error: 'Supabase not configured' }, 500)
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
    return createErrorResponse({ success: false, error: '게시글을 찾을 수 없습니다.' }, 404)
  }
  return NextResponse.json({
    content: (data as any).content || '',
    content_format: (data as any).content_format || 'plain',
  })
}
