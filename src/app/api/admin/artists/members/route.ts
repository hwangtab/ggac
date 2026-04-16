import { createOptionsResponse } from '@/utils/apiResponse'
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/server/adminAuth'
import {
  applyRateLimit,
  RATE_LIMIT_CONFIGS,
  createUserKeyGenerator,
  addRateLimitHeaders,
} from '@/utils/rateLimiter'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET: 아티스트 권한 관리 가능한 멤버 목록 조회
export async function GET(request: NextRequest) {
  try {
    const rateLimiter = applyRateLimit({
      ...RATE_LIMIT_CONFIGS.ADMIN_API,
      keyGenerator: createUserKeyGenerator('admin_artists_members'),
    })
    const rateLimitResult = rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    const { db } = auth

    // 승인된 모든 멤버 조회 (아티스트 권한 부여 대상)
    const { data: members, error: membersError } = await db
      .from('member_profiles')
      .select('id, display_name, email, is_artist, artist_id, artist_role')
      .eq('registration_status', 'approved')
      .eq('is_active', true)
      .order('display_name', { ascending: true })

    if (membersError) {
      console.error('Members fetch error:', membersError)
      return NextResponse.json(
        { error: '멤버 정보를 조회하는 중 오류가 발생했습니다.' },
        { status: 500 }
      )
    }

    const response = NextResponse.json({
      members: members || [],
    })
    return addRateLimitHeaders(
      response,
      RATE_LIMIT_CONFIGS.ADMIN_API.maxRequests,
      rateLimitResult.remaining,
      rateLimitResult.resetTime
    )
  } catch (error) {
    console.error('Admin artist members API error:', error)
    return NextResponse.json(
      { error: '멤버 정보를 조회하는 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
