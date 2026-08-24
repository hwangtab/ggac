import { createOptionsResponse } from '@/utils/apiResponse'
import { NextResponse } from 'next/server'
import { RATE_LIMITS, defineApiRoute } from '@/lib/server/apiRoute'
import { createUserKeyGenerator } from '@/lib/server/rateLimit'
import { ApiSuccess } from '@/utils/apiWrapper'
import type { MemberStatistics } from '@/types'
import { listProfiles, ALL_PROFILES_LIMIT } from '@/db/queries/profiles'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = defineApiRoute({
  method: 'GET',
  name: 'api/admin/members/stats',
  rateLimit: {
    ...RATE_LIMITS.ADMIN_API,
    keyGenerator: createUserKeyGenerator('admin_members_stats'),
  },
  rateLimitHeaders: true,
  auth: 'admin',
  errorResponse: () =>
    NextResponse.json({ error: '멤버 통계를 조회하는 중 오류가 발생했습니다.' }, { status: 500 }),
  handler: async () => {
    // 전체 회원 데이터 조회 (복합 상태 계산용). 통계는 응답에 원본 행을
    // 내보내지 않고 집계값만 돌려주므로 ProfileRow 33개 컬럼을 그대로
    // 받아도 스키마 보존에 영향이 없다 — status 필터 없이 listProfiles로
    // 전체를 한 번에 받는다(회원 23명, getDirectorRoster와 같은 패턴).
    let allMembers: Awaited<ReturnType<typeof listProfiles>>['rows']
    try {
      ;({ rows: allMembers } = await listProfiles({ limit: ALL_PROFILES_LIMIT, offset: 0 }))
    } catch (error) {
      console.error('Members stats fetch error:', error)
      return NextResponse.json(
        { error: '회원 통계를 조회하는 중 오류가 발생했습니다.' },
        { status: 500 }
      )
    }

    // 복합 상태 기반 통계 계산
    const totalMembers = allMembers.length
    const pendingMembers = allMembers.filter(m => m.registration_status === 'pending').length
    const activeApprovedMembers = allMembers.filter(
      m => m.registration_status === 'approved' && m.is_active && !m.is_suspended
    ).length
    const inactiveApprovedMembers = allMembers.filter(
      m => m.registration_status === 'approved' && !m.is_active
    ).length
    const totalApprovedMembers = allMembers.filter(m => m.registration_status === 'approved').length
    const rejectedMembers = allMembers.filter(m => m.registration_status === 'rejected').length
    const suspendedMembers = allMembers.filter(m => m.is_suspended).length
    const artistMembers = allMembers.filter(m => m.is_artist).length
    const adminMembers = allMembers.filter(m => m.is_admin).length
    const directorMembers = allMembers.filter(m => m.is_director).length

    // 멤버십 타입별 분포 (이미 로드된 데이터 사용)
    const membershipTypeDistribution = {
      regular: 0,
      premium: 0,
      lifetime: 0,
    }

    allMembers.forEach(member => {
      if (member.membership_type in membershipTypeDistribution) {
        membershipTypeDistribution[
          member.membership_type as keyof typeof membershipTypeDistribution
        ]++
      }
    })

    // 월별 가입 통계 (이미 로드된 데이터 사용)
    const oneYearAgo = new Date()
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)

    const monthlyData = allMembers.filter(member => new Date(member.created_at) >= oneYearAgo)

    const monthlyRegistrations: { month: string; count: number }[] = []
    const monthCounts: { [key: string]: number } = {}

    // 지난 12개월 초기화
    for (let i = 11; i >= 0; i--) {
      const date = new Date()
      date.setMonth(date.getMonth() - i)
      const monthKey = date.toISOString().slice(0, 7) // YYYY-MM
      monthCounts[monthKey] = 0
    }

    // 실제 데이터 집계
    monthlyData.forEach(member => {
      const monthKey = member.created_at.slice(0, 7)
      if (monthKey in monthCounts) {
        monthCounts[monthKey]++
      }
    })

    // 결과 배열로 변환
    Object.entries(monthCounts).forEach(([month, count]) => {
      monthlyRegistrations.push({ month, count })
    })

    // 평균 프로필 완성도 (이미 로드된 데이터 사용)
    const completenessData = allMembers.filter(m => m.profile_completeness_score != null)
    let averageProfileCompleteness = 0
    if (completenessData.length > 0) {
      const total = completenessData.reduce(
        (sum, member) => sum + (member.profile_completeness_score || 0),
        0
      )
      averageProfileCompleteness = Math.round(total / completenessData.length)
    }

    // 평균 참여도 점수 (이미 로드된 데이터 사용)
    const engagementData = allMembers.filter(m => m.engagement_score != null)
    let averageEngagementScore = 0
    if (engagementData.length > 0) {
      const total = engagementData.reduce((sum, member) => sum + (member.engagement_score || 0), 0)
      averageEngagementScore = Math.round(total / engagementData.length)
    }

    const stats: MemberStatistics = {
      totalMembers,
      activeMembers: activeApprovedMembers, // 활성 승인 회원
      inactiveMembers: inactiveApprovedMembers, // 비활성 승인 회원 (핵심 추가!)
      pendingMembers,
      approvedMembers: totalApprovedMembers, // 전체 승인 회원
      rejectedMembers,
      suspendedMembers,
      artistMembers,
      adminMembers,
      directorMembers,
      monthlyRegistrations,
      membershipTypeDistribution,
      averageProfileCompleteness,
      averageEngagementScore,
    }

    return ApiSuccess.ok(stats)
  },
})

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
