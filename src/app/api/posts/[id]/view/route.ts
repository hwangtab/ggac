import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { applyRateLimit, RATE_LIMIT_CONFIGS } from '@/utils/rateLimiter'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * 게시글 조회수 증가 API
 * POST /api/posts/[id]/view
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Rate limiting 적용
    const rateLimiter = applyRateLimit(RATE_LIMIT_CONFIGS.GENERAL_API)
    const rateLimitResult = rateLimiter(request)
    
    if (!rateLimitResult.success) {
      return rateLimitResult.response!
    }

    const postId = params.id

    if (!postId) {
      return NextResponse.json({ error: 'Post ID is required' }, { status: 400 })
    }

    const supabase = createRouteHandlerClient({ cookies })

    // 사용자 세션 확인 (선택사항 - 비로그인 사용자도 조회 가능)
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user?.id

    // Service Role 클라이언트 생성 (view count 업데이트용)
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceRoleKey) {
      console.error('SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.')
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }

    const serviceSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // 게시글 존재 여부 및 작성자 확인
    const { data: post, error: postError } = await serviceSupabase
      .from('posts')
      .select('id, title, author_id, view_count')
      .eq('id', postId)
      .eq('is_deleted', false)
      .single()

    if (postError || !post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    // 작성자 본인은 조회수 증가시키지 않음
    if (userId && post.author_id === userId) {
      return NextResponse.json({ 
        success: true, 
        view_count: post.view_count,
        message: 'Author view - count not incremented'
      })
    }

    // 중복 조회 방지를 위한 세션 체크
    const viewSessionKey = `post_view_${postId}`
    const lastViewTime = request.headers.get('x-last-view-time')
    
    // 최근 10분 내 같은 게시글을 본 경우 조회수 증가하지 않음
    if (lastViewTime) {
      const timeDiff = Date.now() - parseInt(lastViewTime)
      if (timeDiff < 10 * 60 * 1000) { // 10분
        return NextResponse.json({ 
          success: true, 
          view_count: post.view_count,
          message: 'Recent view - count not incremented'
        })
      }
    }

    // 조회수 증가 (데이터베이스 함수 사용)
    const { data: result, error: incrementError } = await serviceSupabase
      .rpc('increment_post_view_count', { post_uuid: postId })

    if (incrementError) {
      console.error('조회수 증가 오류:', incrementError)
      return NextResponse.json({ error: 'Failed to increment view count' }, { status: 500 })
    }

    const newViewCount = result || post.view_count + 1

    // 활동 로그 기록 (로그인한 사용자만)
    if (userId) {
      try {
        await serviceSupabase
          .from('user_activities')
          .insert({
            user_id: userId,
            action_type: 'page_viewed',
            target_type: 'post',
            target_id: postId,
            details: {
              post_title: post.title,
              view_count: newViewCount
            }
          })
      } catch (activityError) {
        // 활동 로그 실패는 조회수 증가를 막지 않음
        console.warn('활동 로그 기록 실패:', activityError)
      }
    }

    // 응답에 조회 시간 포함 (클라이언트에서 중복 방지용)
    const response = NextResponse.json({
      success: true,
      view_count: newViewCount,
      message: 'View count incremented'
    })

    response.headers.set('x-view-time', Date.now().toString())

    return response

  } catch (error) {
    console.error('게시글 조회 추적 오류:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * 게시글 조회수 조회 API
 * GET /api/posts/[id]/view
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const postId = params.id

    if (!postId) {
      return NextResponse.json({ error: 'Post ID is required' }, { status: 400 })
    }

    const supabase = createRouteHandlerClient({ cookies })

    // 게시글 조회수 조회
    const { data: post, error } = await supabase
      .from('posts')
      .select('view_count')
      .eq('id', postId)
      .eq('is_deleted', false)
      .single()

    if (error || !post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      view_count: post.view_count || 0
    })

  } catch (error) {
    console.error('게시글 조회수 조회 오류:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}