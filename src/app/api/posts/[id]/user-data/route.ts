/**
 * 게시글 상세에서 사용자 맞춤 데이터를 가져오는 API
 * 현재는 좋아요 여부만 반환하지만, 추후 확장 가능
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { validateUUID } from '@/utils/validation'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resolvedParams = await context.params
  const postId = resolvedParams.id

  const validation = validateUUID(postId, '게시글 ID')
  if (!validation.isValid) {
    return NextResponse.json(
      { success: false, error: validation.errors[0] || '잘못된 게시글 ID입니다.' },
      { status: 400 }
    )
  }

  const cookieStore = await cookies()
  const supabase = createRouteHandlerClient({ cookies: () => cookieStore as any })
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.user) {
    return NextResponse.json(
      { success: false, error: 'UNAUTHORIZED', data: { is_liked: false } },
      { status: 401 }
    )
  }

  const searchParams = new URL(request.url).searchParams
  const userIdFromQuery = searchParams.get('user_id')
  if (userIdFromQuery && userIdFromQuery !== session.user.id) {
    return NextResponse.json(
      { success: false, error: 'FORBIDDEN', data: { is_liked: false } },
      { status: 403 }
    )
  }

  const { data: likeRecord, error: likeError } = await supabase
    .from('post_likes')
    .select('id')
    .eq('post_id', validation.sanitized)
    .eq('user_id', session.user.id)
    .maybeSingle()

  if (likeError) {
    console.error('[API user-data] like lookup failed:', likeError)
    return NextResponse.json({ success: false, error: 'LIKE_LOOKUP_FAILED' }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    data: {
      is_liked: !!likeRecord,
    },
  })
}
