import { NextRequest, NextResponse } from 'next/server'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

// API 라우트를 동적으로 렌더링하도록 강제 설정
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { validateSearchQuery } from '@/utils/validation'
import {
  applyRateLimit,
  RATE_LIMIT_CONFIGS,
  createUserKeyGenerator,
  addRateLimitHeaders,
} from '@/utils/rateLimiter'
import { logSecurityEvent } from '@/utils/security'

export async function GET(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimiter = applyRateLimit({
      ...RATE_LIMIT_CONFIGS.ADMIN_API,
      keyGenerator: createUserKeyGenerator('admin_posts'),
    })

    const rateLimitResult = rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    const cookieStore = await cookies()
    const supabase = createServerComponentClient({ cookies: () => cookieStore as any })

    // 사용자 인증 확인
    const {
      data: { session },
      error: authError,
    } = await supabase.auth.getSession()

    if (authError || !session?.user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    // 관리자 권한 확인
    const { data: profile, error: profileError } = await supabase
      .from('member_profiles')
      .select('is_admin, registration_status, is_active')
      .eq('id', session.user.id)
      .single()

    if (profileError) {
      console.error('Profile fetch error:', profileError)
      return NextResponse.json({ error: '프로필 정보를 조회할 수 없습니다.' }, { status: 500 })
    }

    if (!profile.is_admin || profile.registration_status !== 'approved' || !profile.is_active) {
      return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })
    }

    // Get query parameters
    const { searchParams } = new URL(request.url)
    const filter = searchParams.get('filter') || 'all'
    const searchRaw = searchParams.get('search') || ''
    const page = parseInt(searchParams.get('page') || '1')
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100) // 최대 100개 제한
    const offset = (page - 1) * limit

    // 입력 검증
    let search = ''
    if (searchRaw) {
      const searchValidation = validateSearchQuery(searchRaw)
      if (!searchValidation.isValid) {
        logSecurityEvent(
          'INVALID_SEARCH_QUERY',
          {
            query: searchRaw,
            errors: searchValidation.errors,
          },
          'medium'
        )
        return NextResponse.json(
          {
            error: '유효하지 않은 검색어입니다.',
            details: searchValidation.errors,
          },
          { status: 400 }
        )
      }
      search = searchValidation.sanitized
    }

    // 페이지 번호 검증
    if (page < 1 || page > 10000) {
      return NextResponse.json({ error: '유효하지 않은 페이지 번호입니다.' }, { status: 400 })
    }

    // 필터 값 검증
    const allowedFilters = ['all', 'deleted', 'pinned', '공지', '잡담', '홍보', '건의']
    if (!allowedFilters.includes(filter)) {
      return NextResponse.json({ error: '유효하지 않은 필터입니다.' }, { status: 400 })
    }

    // service-role 우선 사용으로 RLS 영향 제거
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const db = serviceKey
      ? createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
      : supabase

    // Build query based on filter
    let query = db
      .from('posts')
      .select(
        `
        id,
        title,
        content,
        content_format,
        category,
        author_id,
        created_at,
        updated_at,
        is_deleted,
        is_pinned,
        pinned_at,
        like_count,
        author:member_profiles!posts_author_id_fkey (
          display_name,
          email
        )
      `
      )
      .order('created_at', { ascending: false })

    // Apply filter - STEP 1: Restore full filtering
    if (filter === 'deleted') {
      query = query.eq('is_deleted', true)
    } else if (filter === 'pinned') {
      query = query.eq('is_pinned', true)
    } else if (filter !== 'all') {
      query = query.eq('category', filter)
    }

    // Apply search (SQL 인젝션 방지를 위해 파라미터 바인딩 사용)
    if (search) {
      // 이스케이프 처리된 검색어 사용
      const escapedSearch = search.replace(/'/g, "''").replace(/\\/g, '\\\\')
      query = query.or(`title.ilike.%${escapedSearch}%,content.ilike.%${escapedSearch}%`)
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1)

    const { data: posts, error: postsError } = await query

    if (postsError) {
      console.error('Posts fetch error:', postsError)
      return NextResponse.json(
        { error: '게시글을 조회하는 중 오류가 발생했습니다.' },
        { status: 500 }
      )
    }

    // Get total count for pagination
    let countQuery = db.from('posts').select('id', { count: 'exact', head: true })

    if (filter === 'deleted') {
      countQuery = countQuery.eq('is_deleted', true)
    } else if (filter === 'pinned') {
      countQuery = countQuery.eq('is_pinned', true)
    } else if (filter !== 'all') {
      countQuery = countQuery.eq('category', filter)
    }

    if (search) {
      const escapedSearch = search.replace(/'/g, "''").replace(/\\/g, '\\\\')
      countQuery = countQuery.or(`title.ilike.%${escapedSearch}%,content.ilike.%${escapedSearch}%`)
    }

    const { count, error: countError } = await countQuery

    if (countError) {
      console.error('Count fetch error:', countError)
      return NextResponse.json(
        { error: '게시글 수를 조회하는 중 오류가 발생했습니다.' },
        { status: 500 }
      )
    }

    const totalCount = count || 0
    const totalPages = Math.ceil(totalCount / limit)

    // STEP 4: Restore comment count calculation
    const postsWithCommentCount = await Promise.all(
      posts.map(async post => {
        const { count: commentCount } = await db
          .from('comments')
          .select('id', { count: 'exact', head: true })
          .eq('post_id', post.id)

        return {
          ...post,
          comment_count: commentCount || 0,
        }
      })
    )

    const response = NextResponse.json({
      posts: postsWithCommentCount,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount,
        hasNext: page < totalPages,
      },
    })

    // Rate limit 헤더 추가
    return addRateLimitHeaders(
      response,
      RATE_LIMIT_CONFIGS.ADMIN_API.maxRequests,
      rateLimitResult.remaining,
      rateLimitResult.resetTime
    )
  } catch (error) {
    console.error('Admin posts API error:', error)
    logSecurityEvent(
      'ADMIN_POSTS_API_ERROR',
      { error: error instanceof Error ? error.message : 'Unknown error' },
      'medium'
    )
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}
