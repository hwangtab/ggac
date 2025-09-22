import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import type { MemberStatistics } from '@/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const supabase = createServerComponentClient({ cookies: () => cookieStore })

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

    if (
      profileError ||
      !profile.is_admin ||
      profile.registration_status !== 'approved' ||
      !profile.is_active
    ) {
      return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 })
    }

    // 서비스 롤 클라이언트(있으면 RLS 우회)
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const db =
      url && serviceKey
        ? createClient(url, serviceKey, {
            auth: { autoRefreshToken: false, persistSession: false },
          })
        : supabase

    // 전체 회원 데이터 조회 (복합 상태 계산용)
    const { data: allMembers, error: membersError } = await db.from('member_profiles').select(`
        id,
        registration_status,
        is_active,
        is_admin,
        is_artist,
        is_suspended,
        membership_type,
        profile_completeness_score,
        engagement_score,
        created_at
      `)

    if (membersError) {
      console.error('Members stats fetch error:', membersError)
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

    console.log('📊 복합 통계 계산 완료:', {
      totalMembers,
      pendingMembers,
      activeApprovedMembers,
      inactiveApprovedMembers,
      totalApprovedMembers,
      rejectedMembers,
      suspendedMembers,
    })

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
      monthlyRegistrations,
      membershipTypeDistribution,
      averageProfileCompleteness,
      averageEngagementScore,
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
