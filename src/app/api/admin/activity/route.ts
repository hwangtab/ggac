import { createOptionsResponse } from '@/utils/apiResponse'
import { NextResponse } from 'next/server'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { logSecurityEvent } from '@/utils/security'
import { parseIntegerParam } from '@/utils/queryParams'
import { listRecentProfilesForActivity } from '@/db/queries/profiles'
import { listRecentPostsForActivity } from '@/db/queries/posts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET: 관리자 대시보드 최근 활동 조회 (성능 최적화)
export const GET = defineApiRoute({
  method: 'GET',
  name: 'api/admin/activity',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_activity'),
  },
  rateLimitHeaders: true,
  auth: 'admin',
  errorResponse: () => {
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
  },
  handler: async ({ request }) => {
    // 쿼리 파라미터 추출 및 검증
    const { searchParams } = new URL(request.url)
    const page = parseIntegerParam(searchParams.get('page'), 1, { min: 1 })
    const limit = parseIntegerParam(searchParams.get('limit'), 20, { min: 10, max: 50 })
    const days = parseIntegerParam(searchParams.get('days'), 7, { min: 1, max: 30 })

    // 페이지 번호 검증
    if (page > 1000) {
      return ApiError.badRequest('유효하지 않은 페이지 번호입니다.').toNextResponse()
    }

    const offset = (page - 1) * limit
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    // 최적화된 단일 쿼리로 활동 데이터 수집
    const activities: any[] = []

    // Task 8: member_profiles/posts 조회를 Supabase에서 Turso 쿼리 계층
    // (listRecentProfilesForActivity/listRecentPostsForActivity)으로
    // 옮겼다 — 둘 다 이미 Turso가 권위(단계 3c 이후)이므로 이 라우트에는
    // 더 이상 교차 DB 조회가 남지 않는다(user_activities 등은 애초에 이
    // 라우트가 읽지 않았다).

    // 최근 회원 가입 활동 (DB 레벨에서 페이지네이션 적용)
    let memberActivities: Awaited<ReturnType<typeof listRecentProfilesForActivity>> = []
    try {
      memberActivities = await listRecentProfilesForActivity(
        cutoffDate,
        Math.ceil(limit / 2) // 절반은 회원 활동, 절반은 게시글 활동으로 분배
      )
    } catch (error) {
      console.error('Member activities fetch error:', error)
    }

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

    // 최근 게시글 활동 (DB 레벨에서 페이지네이션 적용)
    let postActivities: Awaited<ReturnType<typeof listRecentPostsForActivity>> = []
    try {
      postActivities = await listRecentPostsForActivity(cutoffDate, Math.ceil(limit / 2))
    } catch (error) {
      console.error('Post activities fetch error:', error)
    }

    postActivities.forEach(post => {
      activities.push({
        id: `post_created_${post.id}`,
        type: 'post_created',
        title: `새 게시글: "${post.title}"`,
        description: `${post.author?.display_name || '알 수 없는 사용자'}님이 ${post.category} 카테고리에 게시글을 작성했습니다.`,
        timestamp: post.created_at,
        user: {
          name: post.author?.display_name || '알 수 없는 사용자',
        },
        category: post.category,
        is_pinned: post.is_pinned,
      })
    })

    // 활동들을 시간순으로 정렬하고 페이지네이션 적용
    activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    // 전체 활동 수 계산 (근사치)
    const totalActivitiesApprox = memberActivities.length + postActivities.length
    const paginatedActivities = activities.slice(offset, offset + limit)

    // 페이지네이션 정보 계산
    const totalPages = Math.ceil(totalActivitiesApprox / limit)
    const hasNext = page < totalPages

    return ApiSuccess.ok({
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
  },
})

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
