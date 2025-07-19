import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import type { MemberStatistics } from '@/types'

export async function GET(request: NextRequest) {
  try {
    const cookieStore = cookies()
    const supabase = createServerComponentClient({ cookies: () => cookieStore })

    // 사용자 인증 확인
    const { data: { session }, error: authError } = await supabase.auth.getSession()
    
    if (authError || !session?.user) {
      return NextResponse.json(
        { error: '인증이 필요합니다.' },
        { status: 401 }
      )
    }

    // 관리자 권한 확인
    const { data: profile, error: profileError } = await supabase
      .from('member_profiles')
      .select('is_admin, registration_status, is_active')
      .eq('id', session.user.id)
      .single()

    if (profileError || !profile.is_admin || profile.registration_status !== 'approved' || !profile.is_active) {
      return NextResponse.json(
        { error: '관리자 권한이 필요합니다.' },
        { status: 403 }
      )
    }

    // 기본 통계 수집
    const { count: totalMembers } = await supabase
      .from('member_profiles')
      .select('id', { count: 'exact', head: true })

    const { count: activeMembers } = await supabase
      .from('member_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)

    const { count: pendingMembers } = await supabase
      .from('member_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('registration_status', 'pending')

    const { count: approvedMembers } = await supabase
      .from('member_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('registration_status', 'approved')

    const { count: rejectedMembers } = await supabase
      .from('member_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('registration_status', 'rejected')

    const { count: suspendedMembers } = await supabase
      .from('member_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('is_suspended', true)

    const { count: artistMembers } = await supabase
      .from('member_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('is_artist', true)

    const { count: adminMembers } = await supabase
      .from('member_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('is_admin', true)

    // 멤버십 타입별 분포
    const { data: membershipData } = await supabase
      .from('member_profiles')
      .select('membership_type')

    const membershipTypeDistribution = {
      regular: 0,
      premium: 0,
      lifetime: 0
    }

    if (membershipData) {
      membershipData.forEach(member => {
        if (member.membership_type in membershipTypeDistribution) {
          membershipTypeDistribution[member.membership_type as keyof typeof membershipTypeDistribution]++
        }
      })
    }

    // 월별 가입 통계 (12개월)
    const oneYearAgo = new Date()
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)

    const { data: monthlyData } = await supabase
      .from('member_profiles')
      .select('created_at')
      .gte('created_at', oneYearAgo.toISOString())
      .order('created_at', { ascending: true })

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
    if (monthlyData) {
      monthlyData.forEach(member => {
        const monthKey = member.created_at.slice(0, 7)
        if (monthKey in monthCounts) {
          monthCounts[monthKey]++
        }
      })
    }

    // 결과 배열로 변환
    Object.entries(monthCounts).forEach(([month, count]) => {
      monthlyRegistrations.push({ month, count })
    })

    // 평균 프로필 완성도
    const { data: completenessData } = await supabase
      .from('member_profiles')
      .select('profile_completeness_score')
      .not('profile_completeness_score', 'is', null)

    let averageProfileCompleteness = 0
    if (completenessData && completenessData.length > 0) {
      const total = completenessData.reduce((sum, member) => sum + (member.profile_completeness_score || 0), 0)
      averageProfileCompleteness = Math.round(total / completenessData.length)
    }

    // 평균 참여도 점수
    const { data: engagementData } = await supabase
      .from('member_profiles')
      .select('engagement_score')
      .not('engagement_score', 'is', null)

    let averageEngagementScore = 0
    if (engagementData && engagementData.length > 0) {
      const total = engagementData.reduce((sum, member) => sum + (member.engagement_score || 0), 0)
      averageEngagementScore = Math.round(total / engagementData.length)
    }

    const stats: MemberStatistics = {
      totalMembers: totalMembers || 0,
      activeMembers: activeMembers || 0,
      pendingMembers: pendingMembers || 0,
      approvedMembers: approvedMembers || 0,
      rejectedMembers: rejectedMembers || 0,
      suspendedMembers: suspendedMembers || 0,
      artistMembers: artistMembers || 0,
      adminMembers: adminMembers || 0,
      monthlyRegistrations,
      membershipTypeDistribution,
      averageProfileCompleteness,
      averageEngagementScore
    }

    return NextResponse.json(stats)

  } catch (error) {
    console.error('Member stats API error:', error)
    return NextResponse.json(
      { error: '멤버 통계를 조회하는 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}

// OPTIONS: CORS 지원
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}
