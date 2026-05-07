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

// POST: 아티스트에 멤버 배정
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const resolvedParams = await context.params

  try {
    const rateLimiter = await applyRateLimit({
      ...RATE_LIMIT_CONFIGS.ADMIN_API,
      keyGenerator: createUserKeyGenerator('admin_artists_id_members'),
    })
    const rateLimitResult = await rateLimiter(request)
    if (!rateLimitResult.success && rateLimitResult.response) {
      return rateLimitResult.response
    }

    const auth = await requireAdmin()
    if (auth instanceof NextResponse) return auth
    const { db } = auth

    // 요청 데이터 파싱
    const { memberId, role } = await request.json()
    const artistId = resolvedParams.id

    // 아티스트 ID 형식 검증 — member_profiles.artist_id는 legacy_id(예: 'artist-015')를 보관한다.
    const legacyIdPattern = /^artist-\d{3,}$/
    if (!artistId || !legacyIdPattern.test(artistId)) {
      return createErrorResponse({ success: false, error: '유효하지 않은 아티스트 ID입니다.' }, 400)
    }
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!memberId || !uuidPattern.test(memberId)) {
      return createErrorResponse({ success: false, error: '유효하지 않은 멤버 ID입니다.' }, 400)
    }

    // 아티스트 존재 확인
    const { data: artistExists, error: artistLookupError } = await db
      .from('artists')
      .select('legacy_id')
      .eq('legacy_id', artistId)
      .maybeSingle()
    if (artistLookupError || !artistExists) {
      return createErrorResponse({ success: false, error: '아티스트를 찾을 수 없습니다.' }, 404)
    }

    if (!role) {
      return createErrorResponse({ success: false, error: '역할이 필요합니다.' }, 400)
    }

    if (!['owner', 'manager', 'collaborator'].includes(role)) {
      return createErrorResponse({ success: false, error: '유효하지 않은 역할입니다.' }, 400)
    }

    // 대상 멤버 확인
    const { data: targetMember, error: memberError } = await db
      .from('member_profiles')
      .select('id, display_name, email, artist_id, artist_role')
      .eq('id', memberId)
      .eq('registration_status', 'approved')
      .eq('is_active', true)
      .single()

    if (memberError || !targetMember) {
      return createErrorResponse({ success: false, error: '멤버를 찾을 수 없습니다.' }, 404)
    }

    // 이미 다른 아티스트에 배정되어 있는지 확인
    if (targetMember.artist_id && targetMember.artist_id !== artistId) {
      return NextResponse.json(
        { error: '이미 다른 아티스트에 배정된 멤버입니다.' },
        { status: 400 }
      )
    }

    // 아티스트 배정 업데이트
    const { data: updatedMember, error: updateError } = await db
      .from('member_profiles')
      .update({
        artist_id: artistId,
        artist_role: role,
        is_artist: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', memberId)
      .select()
      .single()

    if (updateError) {
      console.error('Member update error:', updateError)
      return createErrorResponse({ success: false, error: '아티스트 배정에 실패했습니다.' }, 500)
    }

    const response = NextResponse.json({
      success: true,
      message: `${targetMember.display_name}님이 아티스트로 배정되었습니다.`,
      member: updatedMember,
    })
    return addRateLimitHeaders(
      response,
      RATE_LIMIT_CONFIGS.ADMIN_API.maxRequests,
      rateLimitResult.remaining,
      rateLimitResult.resetTime
    )
  } catch (error) {
    console.error('Admin artist assignment API error:', error)
    return createErrorResponse(
      { success: false, error: '아티스트 배정 중 오류가 발생했습니다.' },
      500
    )
  }
}

// OPTIONS: CORS 지원
export async function OPTIONS() {
  return createOptionsResponse()
}
