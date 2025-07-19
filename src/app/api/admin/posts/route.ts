import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { validateSearchQuery } from '@/utils/validation'
import { applyRateLimit, RATE_LIMIT_CONFIGS, createUserKeyGenerator, addRateLimitHeaders } from '@/utils/rateLimiter'
import { logSecurityEvent } from '@/utils/security'

export async function GET(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimiter = applyRateLimit({
      ...RATE_LIMIT_CONFIGS.ADMIN_API,
      keyGenerator: createUserKeyGenerator('admin_posts')
    })
    
    const rateLimitResult = rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }
    
    const supabase = createRouteHandlerClient({ cookies })
    
    // Check authentication and admin status
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('member_profiles')
      .select('is_admin, is_active, registration_status')
      .eq('id', user.id)
      .single()

    if (!profile?.is_admin || !profile?.is_active || profile?.registration_status !== 'approved') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
        logSecurityEvent('INVALID_SEARCH_QUERY', { 
          query: searchRaw, 
          errors: searchValidation.errors 
        }, 'medium')
        return NextResponse.json({ 
          error: '유효하지 않은 검색어입니다.', 
          details: searchValidation.errors 
        }, { status: 400 })
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

    // Build query based on filter
    let query = supabase
      .from('posts')
      .select(`
        id,
        title,
        content,
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
        ),
        attachments:post_attachments(
          id,
          file_name,
          file_url,
          file_type,
          file_size,
          is_primary
        )
      `)
      .order('created_at', { ascending: false })

    // Apply filter
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
      return NextResponse.json({ error: 'Failed to fetch posts' }, { status: 500 })
    }

    // Get total count for pagination
    let countQuery = supabase
      .from('posts')
      .select('id', { count: 'exact', head: true })

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
      return NextResponse.json({ error: 'Failed to fetch count' }, { status: 500 })
    }

    const totalCount = count || 0
    const totalPages = Math.ceil(totalCount / limit)

    // Add comment count to posts (if needed)
    const postsWithCommentCount = await Promise.all(
      posts.map(async (post) => {
        const { count: commentCount } = await supabase
          .from('comments')
          .select('id', { count: 'exact', head: true })
          .eq('post_id', post.id)
        
        return {
          ...post,
          comment_count: commentCount || 0
        }
      })
    )

    const response = NextResponse.json({
      posts: postsWithCommentCount,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount,
        hasNext: page < totalPages
      }
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
    logSecurityEvent('ADMIN_POSTS_API_ERROR', { error: error instanceof Error ? error.message : 'Unknown error' }, 'medium')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
