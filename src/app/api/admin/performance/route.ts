/**
 * API 성능 모니터링 대시보드 엔드포인트
 * 관리자용 성능 통계 및 메트릭 조회
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30
export const preferredRegion = 'icn1'

import { NextRequest, NextResponse } from 'next/server'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { getApiStats, getApiHealth, exportApiMetrics } from '@/utils/apiPerformanceMonitor'

export async function GET(request: NextRequest) {
  try {
    const cookieStore = cookies()
    const supabase = createServerComponentClient({ cookies: () => cookieStore })
    
    // 사용자 인증 확인
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json(
        { error: '인증이 필요합니다.' },
        { status: 401 }
      )
    }

    // 관리자 권한 확인
    const { data: profile, error: profileError } = await supabase
      .from('member_profiles')
      .select('is_admin, registration_status, is_active')
      .eq('id', user.id)
      .single()

    if (profileError) {
      console.error('Profile fetch error:', profileError)
      return NextResponse.json(
        { error: '프로필 정보를 조회할 수 없습니다.' },
        { status: 500 }
      )
    }

    if (!profile.is_admin || profile.registration_status !== 'approved' || !profile.is_active) {
      return NextResponse.json(
        { error: '관리자 권한이 필요합니다.' },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(request.url)
    const action = searchParams.get('action') || 'dashboard'
    const endpoint = searchParams.get('endpoint')
    const timeWindow = parseInt(searchParams.get('timeWindow') || '3600000') // 기본 1시간
    
    switch (action) {
      case 'dashboard':
        const dashboardData = getApiStats(undefined, timeWindow)
        return NextResponse.json({
          success: true,
          data: dashboardData,
          timeWindow,
          timestamp: new Date().toISOString()
        })

      case 'endpoint':
        if (!endpoint) {
          return NextResponse.json(
            { error: 'endpoint 파라미터가 필요합니다.' },
            { status: 400 }
          )
        }
        
        const endpointStats = getApiStats(endpoint, timeWindow)
        return NextResponse.json({
          success: true,
          data: endpointStats,
          endpoint,
          timeWindow,
          timestamp: new Date().toISOString()
        })

      case 'health':
        const healthData = getApiHealth()
        return NextResponse.json({
          success: true,
          data: healthData,
          timestamp: new Date().toISOString()
        })

      case 'export':
        const startTime = searchParams.get('startTime')
        const endTime = searchParams.get('endTime')
        
        if (!startTime || !endTime) {
          return NextResponse.json(
            { error: 'startTime과 endTime 파라미터가 필요합니다.' },
            { status: 400 }
          )
        }

        try {
          const exportedMetrics = exportApiMetrics(startTime, endTime, endpoint || undefined)
          
          return NextResponse.json({
            success: true,
            data: exportedMetrics,
            count: exportedMetrics.length,
            startTime,
            endTime,
            endpoint: endpoint || 'all',
            timestamp: new Date().toISOString()
          })
        } catch (error) {
          return NextResponse.json(
            { error: '메트릭 내보내기 중 오류가 발생했습니다.' },
            { status: 500 }
          )
        }

      default:
        return NextResponse.json(
          { error: '지원하지 않는 액션입니다.' },
          { status: 400 }
        )
    }

  } catch (error) {
    console.error('API 성능 모니터링 API 오류:', error)
    return NextResponse.json(
      { error: '서버 오류가 발생했습니다.' },
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