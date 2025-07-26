/**
 * 사용자 좋아요 목록 API
 * GET: 사용자가 좋아요한 게시글 목록 조회
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30
export const preferredRegion = 'icn1'

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { applyRateLimit, RATE_LIMIT_CONFIGS, createUserKeyGenerator } from '@/utils/rateLimiter'
import type { UserLikedPost } from '@/types'

// Rate limiting 설정
const rateLimiter = applyRateLimit({
  ...RATE_LIMIT_CONFIGS.GENERAL_API,
  keyGenerator: createUserKeyGenerator('user_likes')
})

/**
 * 사용자 좋아요 목록 조회
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const resolvedParams = await params;
  try {
    // Rate limiting 적용
    const rateLimitResult = rateLimiter(request)
    if (!rateLimitResult.success) {
      return rateLimitResult.response
    }

    const supabase = createRouteHandlerClient({ cookies })
    const { data: { session } } = await supabase.auth.getSession()

    if (!session?.user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    const requestedUserId = resolvedParams.id
    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100)
    const offset = (page - 1) * limit

    // 본인 데이터이거나 관리자만 조회 가능
    if (session.user.id !== requestedUserId) {
      const { data: profile } = await supabase
        .from('member_profiles')
        .select('is_admin')
        .eq('id', session.user.id)
        .single()

      if (!profile?.is_admin) {
        return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 })
      }
    }

    // 사용자가 좋아요한 게시글 목록 조회
    const { data: likedPosts, error: likesError } = await supabase
      .rpc('get_user_likes', {
        p_user_id: requestedUserId,
        p_limit: limit,
        p_offset: offset
      })

    if (likesError) {
      console.error('좋아요 목록 조회 오류:', likesError)
      return NextResponse.json({ error: '좋아요 목록을 조회할 수 없습니다.' }, { status: 500 })
    }

    // 총 좋아요 수 조회
    const { count: totalCount, error: countError } = await supabase
      .from('post_likes')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', requestedUserId)

    if (countError) {
      console.error('좋아요 수 조회 오류:', countError)
      return NextResponse.json({ error: '좋아요 수를 조회할 수 없습니다.' }, { status: 500 })
    }

    const total = totalCount || 0
    const totalPages = Math.ceil(total / limit)

    return NextResponse.json({
      liked_posts: likedPosts || [],
      pagination: {
        current_page: page,
        total_pages: totalPages,
        total_count: total,
        per_page: limit,
        has_next: page < totalPages,
        has_prev: page > 1
      }
    })

  } catch (error) {
    console.error('사용자 좋아요 목록 API 오류:', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}