/**
 * 게시글 목록 조회 API
 * 좋아요 정보를 포함한 게시글 목록 제공
 */

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { applyRateLimit, RATE_LIMIT_CONFIGS, createUserKeyGenerator } from '@/utils/rateLimiter'
import { validateSearchQuery } from '@/utils/validation'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Rate limiting 설정
const rateLimiter = applyRateLimit({
  ...RATE_LIMIT_CONFIGS.GENERAL_API,
  keyGenerator: createUserKeyGenerator('posts')
})

async function GET(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimitResult = rateLimiter(request)
    if (!rateLimitResult.success) {
      return rateLimitResult.response
    }

    const supabase = createRouteHandlerClient({ cookies })
    
    // 인증 확인
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    // 회원 상태 확인
    const { data: profile } = await supabase
      .from('member_profiles')
      .select('registration_status, is_active')
      .eq('id', session.user.id)
      .single()

    if (!profile || profile.registration_status !== 'approved' || !profile.is_active) {
      return NextResponse.json({ error: '승인된 회원만 접근할 수 있습니다.' }, { status: 403 })
    }

    // 쿼리 파라미터 처리
    const { searchParams } = new URL(request.url)
    const category = searchParams.get('category') || '전체'  // 'all' -> '전체'로 변경
    const searchRaw = searchParams.get('search') || ''
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50)
    const offset = (page - 1) * limit
    const sortBy = searchParams.get('sort') || 'created_at'
    const sortOrder = searchParams.get('order') || 'desc'
    const includeLikes = searchParams.get('include_likes') !== 'false' // 기본적으로 포함

    // 검색어 검증
    let search = ''
    if (searchRaw) {
      const searchValidation = validateSearchQuery(searchRaw)
      if (!searchValidation.isValid) {
        return NextResponse.json({ 
          error: '유효하지 않은 검색어입니다.', 
          details: searchValidation.errors 
        }, { status: 400 })
      }
      search = searchValidation.sanitized
    }

    // 허용된 카테고리 검증 - '전체' 사용으로 통일
    const allowedCategories = ['전체', '공지', '잡담', '홍보', '건의']
    if (!allowedCategories.includes(category)) {
      return NextResponse.json({ error: '유효하지 않은 카테고리입니다.' }, { status: 400 })
    }

    // 허용된 정렬 필드 검증
    const allowedSortFields = ['created_at', 'updated_at', 'like_count', 'title']
    if (!allowedSortFields.includes(sortBy)) {
      return NextResponse.json({ error: '유효하지 않은 정렬 필드입니다.' }, { status: 400 })
    }

    // 기본 쿼리 구성
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
        is_pinned,
        like_count,
        author:member_profiles!posts_author_id_fkey (
          display_name,
          email
        )
      `)
      .eq('is_deleted', false) // 삭제되지 않은 게시글만

    // 카테고리 필터 적용 - '전체' 사용으로 통일
    if (category !== '전체') {
      query = query.eq('category', category)
    }

    // 검색어 적용
    if (search) {
      const escapedSearch = search.replace(/'/g, "''").replace(/\\/g, '\\\\')
      query = query.or(`title.ilike.%${escapedSearch}%,content.ilike.%${escapedSearch}%`)
    }

    // 정렬 적용
    const ascending = sortOrder === 'asc'
    if (sortBy === 'created_at') {
      // 고정 게시글을 먼저 표시하고, 그 다음 생성일 순
      query = query.order('is_pinned', { ascending: false, nullsFirst: false })
      query = query.order('created_at', { ascending })
    } else {
      query = query.order(sortBy, { ascending })
    }

    // 페이지네이션 적용
    query = query.range(offset, offset + limit - 1)

    const { data: posts, error: postsError } = await query

    if (postsError) {
      console.error('게시글 조회 오류:', postsError)
      return NextResponse.json({ error: '게시글을 조회할 수 없습니다.' }, { status: 500 })
    }

    // 총 개수 조회 (같은 조건으로)
    let countQuery = supabase
      .from('posts')
      .select('id', { count: 'exact', head: true })
      .eq('is_deleted', false)

    if (category !== '전체') {
      countQuery = countQuery.eq('category', category)
    }

    if (search) {
      const escapedSearch = search.replace(/'/g, "''").replace(/\\/g, '\\\\')
      countQuery = countQuery.or(`title.ilike.%${escapedSearch}%,content.ilike.%${escapedSearch}%`)
    }

    const { count, error: countError } = await countQuery

    if (countError) {
      console.error('게시글 수 조회 오류:', countError)
      return NextResponse.json({ error: '게시글 수를 조회할 수 없습니다.' }, { status: 500 })
    }

    // 댓글 수와 현재 사용자의 좋아요 상태 추가
    const postsWithExtra = await Promise.all(
      (posts || []).map(async (post) => {
        // 댓글 수 조회
        const { count: commentCount } = await supabase
          .from('comments')
          .select('id', { count: 'exact', head: true })
          .eq('post_id', post.id)

        let isLiked = false
        
        // 좋아요 정보 포함 시 현재 사용자의 좋아요 상태 확인
        if (includeLikes) {
          const { data: userLike } = await supabase
            .from('post_likes')
            .select('id')
            .eq('post_id', post.id)
            .eq('user_id', session.user.id)
            .single()
          
          isLiked = !!userLike
        }

        return {
          ...post,
          comment_count: commentCount || 0,
          is_liked: includeLikes ? isLiked : undefined
        }
      })
    )

    const totalCount = count || 0
    const totalPages = Math.ceil(totalCount / limit)

    return NextResponse.json({
      posts: postsWithExtra,
      pagination: {
        current_page: page,
        total_pages: totalPages,
        total_count: totalCount,
        per_page: limit,
        has_next: page < totalPages,
        has_prev: page > 1
      },
      filters: {
        category: category === '전체' ? null : category,
        search: search || null,
        sort_by: sortBy,
        sort_order: sortOrder
      }
    })

  } catch (error) {
    console.error('게시글 목록 API 오류:', error)
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 })
  }
}