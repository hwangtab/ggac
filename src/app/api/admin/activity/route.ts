import { createOptionsResponse } from '@/utils/apiResponse'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import {
  applyRateLimit,
  RATE_LIMIT_CONFIGS,
  createUserKeyGenerator,
  addRateLimitHeaders,
} from '@/utils/rateLimiter'
import { logSecurityEvent } from '@/utils/security'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET: 관리자 대시보드 최근 활동 조회 (성능 최적화)
export async function GET(request: NextRequest) {
  try {
    // Rate limiting 적용
    const rateLimiter = applyRateLimit({
      ...RATE_LIMIT_CONFIGS.ADMIN_API,
      keyGenerator: createUserKeyGenerator('admin_activity'),
    })

    const rateLimitResult = rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    const supabase = await createSupabaseServer()

    // 사용자 인증 확인
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
    }

    // 관리자 권한 확인
    const { data: profile, error: profileError } = await supabase
      .from('member_profiles')
      .select('is_admin, registration_status, is_active')
      .eq('id', user.id)
      .single()

    if (profileError) {
      console.error('Profile fetch error:', profileError)
      return NextResponse.json({ error: '프로필 정보를 조회할 수 없습니다.' }, { status: 500 })
    }

    if (!profile.is_admin || profile.registration_status !== 'approved' || !profile.is_active) {
      return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })
    }

    // 쿼리 파라미터 추출 및 검증
    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(50, Math.max(10, parseInt(searchParams.get('limit') || '20')))
    const days = Math.min(30, Math.max(1, parseInt(searchParams.get('days') || '7')))

    // 페이지 번호 검증
    if (page > 1000) {
      return NextResponse.json({ error: '유효하지 않은 페이지 번호입니다.' }, { status: 400 })
    }

    const offset = (page - 1) * limit
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

    // 최적화된 단일 쿼리로 활동 데이터 수집
    const activities: any[] = []

    // 최근 회원 가입 활동 (DB 레벨에서 페이지네이션 적용)
    const { data: memberActivities, error: memberError } = await supabase
      .from('member_profiles')
      .select('id, display_name, created_at, registration_status, approved_at, updated_at')
      .gte('created_at', cutoffDate)
      .order('created_at', { ascending: false })
      .limit(Math.ceil(limit / 2)) // 절반은 회원 활동, 절반은 게시글 활동으로 분배

    if (memberError) {
      console.error('Member activities fetch error:', memberError)
    } else if (memberActivities) {
      memberActivities.forEach(member => {
        // 회원 가입 활동
        activities.push({
          id: `member_registered_${member.id}`,
          type: 'member_registered',
          title: `${member.display_name}님이 가입했습니다`,
          description: `새로운 회원이 가입하여 ${member.registration_status === 'approved' ? '승인되었습니다' : '승인을 기다리고 있습니다'}.`,
          timestamp: member.created_at,
          user: {
            name: member.display_name,
          },
          status: member.registration_status,
        })

        // 승인 활동이 있는 경우 별도 추가
        if (member.registration_status === 'approved' && member.approved_at) {
          activities.push({
            id: `member_approved_${member.id}`,
            type: 'member_approved',
            title: `${member.display_name}님이 승인되었습니다`,
            description: '새로운 조합원이 승인되어 활동을 시작할 수 있습니다.',
            timestamp: member.approved_at,
            user: {
              name: member.display_name,
            },
          })
        }
      })
    }

    // 최근 게시글 활동 (DB 레벨에서 페이지네이션 적용)
    const { data: postActivities, error: postError } = await supabase
      .from('posts')
      .select(
        `
        id, 
        title, 
        category, 
        created_at,
        is_pinned,
        author:member_profiles!posts_author_id_fkey (
          display_name
        )
      `
      )
      .gte('created_at', cutoffDate)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(Math.ceil(limit / 2))

    if (postError) {
      console.error('Post activities fetch error:', postError)
    } else if (postActivities) {
      postActivities.forEach(post => {
        const author = post.author as any
        activities.push({
          id: `post_created_${post.id}`,
          type: 'post_created',
          title: `새 게시글: "${post.title}"`,
          description: `${author?.display_name || '알 수 없는 사용자'}님이 ${post.category} 카테고리에 게시글을 작성했습니다.`,
          timestamp: post.created_at,
          user: {
            name: author?.display_name || '알 수 없는 사용자',
          },
          category: post.category,
          is_pinned: post.is_pinned,
        })
      })
    }

    // 활동들을 시간순으로 정렬하고 페이지네이션 적용
    activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    // 전체 활동 수 계산 (근사치)
    const totalActivitiesApprox = (memberActivities?.length || 0) + (postActivities?.length || 0)
    const paginatedActivities = activities.slice(offset, offset + limit)

    // 페이지네이션 정보 계산
    const totalPages = Math.ceil(totalActivitiesApprox / limit)
    const hasNext = page < totalPages

    const response = NextResponse.json({
      activities: paginatedActivities,
      pagination: {
        currentPage: page,
        totalPages,
        totalCount: totalActivitiesApprox,
        hasNext,
      },
      metadata: {
        days,
        limit,
        generatedAt: new Date().toISOString(),
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
    console.error('Admin activity API error:', error)
    logSecurityEvent(
      'ADMIN_ACTIVITY_API_ERROR',
      {
        error: '서버 오류가 발생했습니다.',
      },
      'medium'
    )
    return NextResponse.json(
      { error: '활동 내역을 조회하는 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
