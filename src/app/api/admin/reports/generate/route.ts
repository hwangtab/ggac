import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { parseIntegerParam } from '@/utils/queryParams'
import {
  listAllProfilesSummary,
  listProfilesCreatedInRange,
  listProfilesUpdatedInRange,
  listRejectedProfilesInRange,
  listProfileRegistrationStatusInRange,
} from '@/db/queries/profiles'
import { listPostsInRange } from '@/db/queries/posts'
import { listCommentsInRange } from '@/db/queries/comments'

const REPORT_TYPES = [
  'member_activity',
  'post_engagement',
  'user_registration',
  'comprehensive',
] as const
type ReportType = (typeof REPORT_TYPES)[number]

type ReportFilters = {
  includeInactive: boolean
  minimumActivity: number
  categories: string[]
}

const REPORT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MAX_REPORT_RANGE_DAYS = 370

function parseReportType(value: unknown): ReportType | null {
  if (typeof value !== 'string') return null
  return REPORT_TYPES.includes(value as ReportType) ? (value as ReportType) : null
}

function parseReportDay(value: unknown): Date | null {
  if (typeof value !== 'string' || !REPORT_DATE_PATTERN.test(value)) return null

  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime())) return null

  return parsed.toISOString().startsWith(value) ? parsed : null
}

function parseReportDateRange(value: unknown): { startDate: Date; endDate: Date } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const raw = value as Record<string, unknown>
  const startDate = parseReportDay(raw.start)
  const endDate = parseReportDay(raw.end)
  if (!startDate || !endDate || startDate > endDate) return null

  const rangeDays = Math.ceil((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1
  if (rangeDays > MAX_REPORT_RANGE_DAYS) return null

  startDate.setUTCHours(0, 0, 0, 0)
  endDate.setUTCHours(23, 59, 59, 999)
  return { startDate, endDate }
}

function defaultReportDateRange() {
  const endDate = new Date()
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  startDate.setUTCHours(0, 0, 0, 0)
  endDate.setUTCHours(23, 59, 59, 999)
  return { startDate, endDate }
}

function parseReportFilters(value: unknown): ReportFilters {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}

  const categories = Array.isArray(raw.categories)
    ? raw.categories
        .filter((category): category is string => typeof category === 'string')
        .map(category => category.trim())
        .filter(Boolean)
        .slice(0, 20)
    : []

  return {
    includeInactive: raw.includeInactive === true,
    minimumActivity: parseIntegerParam(String(raw.minimumActivity ?? ''), 0, { min: 0 }),
    categories,
  }
}

/**
 * 멤버 리포트 생성 API
 * POST /api/admin/reports/generate
 */
export const POST = defineApiRoute<Record<string, unknown>>({
  method: 'POST',
  name: 'api/admin/reports/generate',
  rateLimit: RATE_LIMITS.ADMIN_API,
  auth: 'admin',
  body: {
    invalidResponse: () => ApiError.badRequest('유효한 JSON body가 필요합니다.').toNextResponse(),
  },
  errorResponse: () => ApiError.internalServerError('Internal server error').toNextResponse(),
  handler: async ({ body, auth }) => {
    const { db: serviceSupabase, user } = auth

    const reportType = parseReportType(body.reportType)
    if (!reportType) {
      return ApiError.badRequest('Invalid report type').toNextResponse()
    }

    const parsedDateRange =
      body.dateRange === undefined ? defaultReportDateRange() : parseReportDateRange(body.dateRange)
    if (!parsedDateRange) {
      return ApiError.badRequest('Invalid date range').toNextResponse()
    }

    const { startDate, endDate } = parsedDateRange
    const filters = parseReportFilters(body.filters)

    // 리포트 유형별 데이터 생성 (Service Role 클라이언트 사용)
    let reportData
    switch (reportType) {
      case 'member_activity':
        reportData = await generateMemberActivityReport(
          serviceSupabase,
          startDate,
          endDate,
          filters
        )
        break
      case 'post_engagement':
        reportData = await generatePostEngagementReport(
          serviceSupabase,
          startDate,
          endDate,
          filters
        )
        break
      case 'user_registration':
        reportData = await generateUserRegistrationReport(
          serviceSupabase,
          startDate,
          endDate,
          filters
        )
        break
      case 'comprehensive':
        reportData = await generateComprehensiveReport(serviceSupabase, startDate, endDate, filters)
        break
      default:
        return ApiError.badRequest('Invalid report type').toNextResponse()
    }

    // 리포트 메타데이터 생성
    const reportMetadata = {
      id: `report_${Date.now()}`,
      type: reportType,
      generatedAt: new Date().toISOString(),
      generatedBy: user.id,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      filters,
      summary: reportData.summary,
    }

    return ApiSuccess.ok({
      report: {
        metadata: reportMetadata,
        data: reportData.data,
      },
    })
  },
})

// 멤버 활동 리포트 생성
async function generateMemberActivityReport(
  supabase: any,
  startDate: Date,
  endDate: Date,
  filters: any
) {
  // 1. 전체 회원 통계 (기본 데이터) — Task 8: member_profiles는 Turso가
  // 권위(단계 3c 이후)라 listAllProfilesSummary(Turso)로 옮겼다.
  // user_activities는 여전히 Supabase 권위(단계 4 대상)라 아래 activities
  // 조회만 supabase 파라미터를 계속 쓴다 — 이 함수가 두 DB를 함께 읽는
  // 과도기 상태는 스펙이 허용한 정상 상태다.
  let allMembers: Awaited<ReturnType<typeof listAllProfilesSummary>> = []
  try {
    allMembers = await listAllProfilesSummary()
  } catch (error) {
    console.error('회원 데이터 조회 오류:', error)
  }

  // 2. 기간별 활동 통계 (수정된 쿼리 - 관계 문제 해결)
  const { data: activities, error: activitiesError } = await supabase
    .from('user_activities')
    .select('id, user_id, action_type, created_at')
    .gte('created_at', startDate.toISOString())
    .lte('created_at', endDate.toISOString())

  if (activitiesError) {
    console.error('사용자 활동 데이터 조회 오류:', activitiesError)
  }

  // 3. 활동별 집계
  const activitySummary =
    activities?.reduce((acc: any, activity: any) => {
      const actionType = activity.action_type
      acc[actionType] = (acc[actionType] || 0) + 1
      return acc
    }, {}) || {}

  // 4. 사용자별 활동 집계 (폴백: 모든 회원 포함)
  const userActivityMap: any = {}

  // 모든 회원을 기본으로 추가
  allMembers?.forEach((member: any) => {
    userActivityMap[member.id] = {
      userId: member.id,
      displayName: member.display_name,
      email: member.email,
      totalActivities: 0,
      activities: {},
      registrationStatus: member.registration_status,
      isActive: member.is_active,
    }
  })

  // 활동 데이터가 있으면 추가 (수동 조인)
  activities?.forEach((activity: any) => {
    const userId = activity.user_id

    // userActivityMap에 사용자가 없으면 (활동은 있지만 member_profiles에 없는 경우) 기본 정보로 추가
    if (!userActivityMap[userId]) {
      userActivityMap[userId] = {
        userId: userId,
        displayName: 'Unknown User',
        email: 'unknown@example.com',
        totalActivities: 0,
        activities: {},
        registrationStatus: 'unknown',
        isActive: false,
      }
    }

    // 활동 수 증가
    userActivityMap[userId].totalActivities++
    userActivityMap[userId].activities[activity.action_type] =
      (userActivityMap[userId].activities[activity.action_type] || 0) + 1
  })

  const userActivities = Object.values(userActivityMap).sort(
    (a: any, b: any) => b.totalActivities - a.totalActivities
  )

  // 5. 회원 통계 요약
  const memberStats = {
    총회원수: allMembers?.length || 0,
    승인회원수: allMembers?.filter((m: any) => m.registration_status === 'approved').length || 0,
    대기회원수: allMembers?.filter((m: any) => m.registration_status === 'pending').length || 0,
    활성회원수: allMembers?.filter((m: any) => m.is_active).length || 0,
  }

  return {
    summary: {
      총활동수: activities?.length || 0,
      순사용자수: activities?.length > 0 ? new Set(activities.map((a: any) => a.user_id)).size : 0,
      주요활동:
        Object.entries(activitySummary).sort(([, a]: any, [, b]: any) => b - a)[0]?.[0] || 'none',
      사용자당평균활동수:
        activities?.length > 0 && userActivities.length > 0
          ? Math.round(
              (activities.length / new Set(activities.map((a: any) => a.user_id)).size) * 100
            ) / 100
          : 0,
      ...memberStats,
    },
    data: {
      activitySummary,
      userActivities: userActivities.slice(0, 50), // 상위 50명만
      dailyActivities: await getDailyActivityBreakdown(supabase, startDate, endDate),
      memberBreakdown: memberStats,
    },
  }
}

// 게시글 참여도 리포트 생성
async function generatePostEngagementReport(
  supabase: any,
  startDate: Date,
  endDate: Date,
  filters: any
) {
  // Task 8: posts/comments는 Turso가 권위(단계 3c 이후)라
  // listPostsInRange/listCommentsInRange(Turso)로 옮겼다. 이 함수는 다른
  // 표(user_activities 등)를 읽지 않으므로 교차 DB가 남지 않는다 —
  // `supabase` 파라미터는 함수 시그니처 통일(generateComprehensiveReport가
  // 4개 함수를 같은 방식으로 호출) 목적으로만 남아 있다.
  let posts: Awaited<ReturnType<typeof listPostsInRange>> = []
  try {
    posts = await listPostsInRange(startDate, endDate)
  } catch (error) {
    console.error('게시글 조회 오류:', error)
  }

  let comments: Awaited<ReturnType<typeof listCommentsInRange>> = []
  try {
    comments = await listCommentsInRange(startDate, endDate)
  } catch (error) {
    console.error('댓글 조회 오류:', error)
  }

  // 게시글별 댓글 수 계산
  const commentsByPost =
    comments?.reduce((acc: any, comment: any) => {
      acc[comment.post_id] = (acc[comment.post_id] || 0) + 1
      return acc
    }, {}) || {}

  // 카테고리별 분석 (올바른 컬럼명 사용)
  const categoryStats =
    posts?.reduce((acc: any, post: any) => {
      const category = post.category
      if (!acc[category]) {
        acc[category] = { count: 0, totalLikes: 0, totalComments: 0 }
      }
      acc[category].count++
      acc[category].totalLikes += post.like_count || 0
      acc[category].totalComments += commentsByPost[post.id] || 0
      return acc
    }, {}) || {}

  return {
    summary: {
      총게시글수: posts?.length || 0,
      총댓글수: comments?.length || 0,
      총조회수: posts?.reduce((sum: number, post: any) => sum + (post.view_count || 0), 0) || 0,
      총좋아요수: posts?.reduce((sum: number, post: any) => sum + (post.like_count || 0), 0) || 0,
      평균참여도:
        posts?.length > 0
          ? Math.round(
              (((comments?.length || 0) +
                (posts?.reduce((sum: number, post: any) => sum + (post.like_count || 0), 0) || 0) +
                (posts?.reduce((sum: number, post: any) => sum + (post.view_count || 0), 0) || 0)) /
                posts.length) *
                100
            ) / 100
          : 0,
    },
    data: {
      topPosts:
        posts?.slice(0, 10).map((post: any) => ({
          ...post,
          commentCount: commentsByPost[post.id] || 0,
        })) || [],
      categoryStats,
      engagementTrends: await getEngagementTrends(supabase, startDate, endDate),
    },
  }
}

// 사용자 등록 리포트 생성
async function generateUserRegistrationReport(
  supabase: any,
  startDate: Date,
  endDate: Date,
  filters: any
) {
  // Task 8: member_profiles는 Turso가 권위(단계 3c 이후)라 아래 4개 조회를
  // 모두 profiles.ts 쿼리 계층으로 옮겼다. 이 함수는 다른 표를 읽지 않으므로
  // 교차 DB가 남지 않는다.
  // 1. 기간 내 신규 등록자 (created_at 기준)
  const newRegistrations = await listProfilesCreatedInRange(startDate, endDate)

  // 2. 기간 내 상태가 변경된 회원들 (updated_at 기준)
  const statusChanges = await listProfilesUpdatedInRange(startDate, endDate)

  // 3. 신규 등록 통계
  const newRegistrationStats =
    newRegistrations?.reduce((acc: any, user: any) => {
      acc[user.registration_status] = (acc[user.registration_status] || 0) + 1
      return acc
    }, {}) || {}

  // 4. 상태 변경 통계 (승인/거부된 회원 추적)
  const statusChangeStats =
    statusChanges?.reduce((acc: any, user: any) => {
      acc[user.registration_status] = (acc[user.registration_status] || 0) + 1
      return acc
    }, {}) || {}

  // 5. 최근 거부된 회원들 (created_at과 관계없이 최근에 거부된 모든 회원)
  const recentlyRejected = await listRejectedProfilesInRange(startDate, endDate)

  return {
    summary: {
      // 신규 등록 기준 통계
      총신규등록수: newRegistrations?.length || 0,
      신규승인수: newRegistrationStats.approved || 0,
      신규대기수: newRegistrationStats.pending || 0,
      신규거부수: newRegistrationStats.rejected || 0,

      // 상태 변경 기준 통계 (더 정확한 승인/거부 추적)
      승인수: statusChangeStats.approved || 0,
      대기수: statusChangeStats.pending || 0,
      거부수: recentlyRejected?.length || 0, // 실제 거부된 회원 수

      아티스트수: newRegistrations?.filter((u: any) => u.is_artist).length || 0,
    },
    data: {
      newRegistrationStats,
      statusChangeStats,
      dailyRegistrations: await getDailyRegistrationBreakdown(supabase, startDate, endDate),
      recentRegistrations: newRegistrations?.slice(0, 20) || [],
      recentlyRejected: recentlyRejected || [],
      recentStatusChanges: statusChanges?.slice(0, 20) || [],
    },
  }
}

// 종합 리포트 생성
async function generateComprehensiveReport(
  supabase: any,
  startDate: Date,
  endDate: Date,
  filters: any
) {
  const [memberActivity, postEngagement, userRegistration] = await Promise.all([
    generateMemberActivityReport(supabase, startDate, endDate, filters),
    generatePostEngagementReport(supabase, startDate, endDate, filters),
    generateUserRegistrationReport(supabase, startDate, endDate, filters),
  ])

  return {
    summary: {
      ...memberActivity.summary,
      ...postEngagement.summary,
      ...userRegistration.summary,
      systemHealth: 'good', // 추후 시스템 상태 로직 추가
    },
    data: {
      memberActivity: memberActivity.data,
      postEngagement: postEngagement.data,
      userRegistration: userRegistration.data,
    },
  }
}

// 일별 활동 분석
async function getDailyActivityBreakdown(supabase: any, startDate: Date, endDate: Date) {
  const { data, error } = await supabase
    .from('daily_activity_stats')
    .select('activity_date, action_type, count')
    .gte('activity_date', startDate.toISOString().split('T')[0])
    .lte('activity_date', endDate.toISOString().split('T')[0])
    .order('activity_date', { ascending: true })

  if (error) {
    console.error('일별 활동 통계 조회 오류:', error)
  }

  return data || []
}

// 참여도 트렌드 분석
async function getEngagementTrends(supabase: any, startDate: Date, endDate: Date) {
  // 주간 집계로 트렌드 분석
  const { data } = await supabase
    .from('weekly_activity_stats')
    .select('week_start, action_type, total_count, unique_users')
    .gte('week_start', startDate.toISOString())
    .lte('week_start', endDate.toISOString())
    .order('week_start', { ascending: true })

  return data || []
}

// 일별 등록 분석
// Task 8: member_profiles는 Turso가 권위라 listProfileRegistrationStatusInRange
// (Turso)로 옮겼다 — `supabase` 파라미터는 이제 이 함수 안에서 쓰이지
// 않지만, generateUserRegistrationReport의 나머지 3개 리포트 헬퍼
// (getDailyActivityBreakdown/getEngagementTrends 포함)와 같은 호출 방식을
// 유지하려고 시그니처는 그대로 둔다.
async function getDailyRegistrationBreakdown(_supabase: any, startDate: Date, endDate: Date) {
  const data = await listProfileRegistrationStatusInRange(startDate, endDate)

  // 일별로 그룹화
  const dailyStats =
    data?.reduce((acc: any, profile: any) => {
      const date = profile.created_at.split('T')[0]
      if (!acc[date]) {
        acc[date] = { date, total: 0, approved: 0, pending: 0, rejected: 0 }
      }
      acc[date].total++
      acc[date][profile.registration_status]++
      return acc
    }, {}) || {}

  return Object.values(dailyStats).sort((a: any, b: any) => a.date.localeCompare(b.date))
}
