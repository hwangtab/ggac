export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30
export const preferredRegion = 'icn1'

import { createOptionsResponse, createErrorResponse } from '@/utils/apiResponse'
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/server/adminAuth'
import {
  applyRateLimit,
  RATE_LIMIT_CONFIGS,
  createUserKeyGenerator,
  addRateLimitHeaders,
} from '@/utils/rateLimiter'

// DELETE: 아티스트 배정 해제
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; memberId: string }> }
) {
  const resolvedParams = await context.params
  try {
    const rateLimiter = await applyRateLimit({
      ...RATE_LIMIT_CONFIGS.ADMIN_API,
      keyGenerator: createUserKeyGenerator('admin_artists_member_action'),
    })
    const rateLimitResult = await rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    const { db } = auth

    const artistId = resolvedParams.id
    const memberId = resolvedParams.memberId

    // 아티스트 ID 형식 검증 — member_profiles.artist_id는 legacy_id를 보관한다.
    const legacyIdPattern = /^artist-\d{3,}$/
    if (!artistId || !legacyIdPattern.test(artistId)) {
      return createErrorResponse({ success: false, error: '유효하지 않은 아티스트 ID입니다.' }, 400)
    }
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!memberId || !uuidPattern.test(memberId)) {
      return createErrorResponse({ success: false, error: '유효하지 않은 멤버 ID입니다.' }, 400)
    }

    // 대상 멤버 확인
    const { data: targetMember, error: memberError } = await db
      .from('member_profiles')
      .select('id, display_name, email, artist_id, artist_role')
      .eq('id', memberId)
      .single()

    if (memberError || !targetMember) {
      return createErrorResponse({ success: false, error: '멤버를 찾을 수 없습니다.' }, 404)
    }

    // 해당 아티스트에 배정된 멤버인지 확인
    if (targetMember.artist_id !== artistId) {
      return NextResponse.json(
        { error: '해당 아티스트에 배정된 멤버가 아닙니다.' },
        { status: 400 }
      )
    }

    // 아티스트 배정 해제
    const { data: updatedMember, error: updateError } = await db
      .from('member_profiles')
      .update({
        artist_id: null,
        artist_role: null,
        is_artist: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', memberId)
      .select()
      .single()

    if (updateError) {
      console.error('Member update error:', updateError)
      return createErrorResponse(
        { success: false, error: '아티스트 배정 해제에 실패했습니다.' },
        500
      )
    }

    const response = NextResponse.json({
      success: true,
      message: `${targetMember.display_name}님의 아티스트 배정이 해제되었습니다.`,
      member: updatedMember,
    })
    return addRateLimitHeaders(
      response,
      RATE_LIMIT_CONFIGS.ADMIN_API.maxRequests,
      rateLimitResult.remaining,
      rateLimitResult.resetTime
    )
  } catch (error) {
    console.error('Admin artist unassignment API error:', error)
    return NextResponse.json(
      { error: '아티스트 배정 해제 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
