import { NextRequest } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { fetchLinkPreview } from '@/utils/linkPreview'
import distLimiter from '@/lib/server/rateLimit'
import { createSupabaseServer } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  // 인증 확인 — 로그인한 사용자만 링크 프리뷰 요청 가능
  const supabase = await createSupabaseServer()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return ApiError.unauthorized('로그인이 필요합니다.').toNextResponse()
  }

  // 분산 레이트리밋 (Upstash 있으면 Redis, 없으면 메모리)
  const limiter = await distLimiter.applyRateLimit({
    ...distLimiter.CONFIGS.SEARCH_API,
    keyGenerator: distLimiter.createRouteKeyGenerator('link_preview'),
  })
  const limit = await limiter(request)
  if (!limit.success && limit.response) {
    return limit.response
  }
  const { searchParams } = new URL(request.url)
  const url = searchParams.get('url')

  if (!url) {
    return ApiError.badRequest('URL parameter is required').toNextResponse()
  }

  try {
    // 프로토콜 및 형식 1차 검증 (세부 SSRF 검사는 유틸 내부에서 수행)
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return ApiError.badRequest('Only http/https are allowed').toNextResponse()
    }
  } catch {
    return ApiError.badRequest('Invalid URL format').toNextResponse()
  }

  try {
    const preview = await fetchLinkPreview(url)

    if (!preview) {
      return ApiError.notFound('Failed to fetch link preview').toNextResponse()
    }

    const res = ApiSuccess.ok(preview).toNextResponse()
    return distLimiter.addRateLimitHeaders(
      res,
      distLimiter.CONFIGS.SEARCH_API.maxRequests,
      limit.remaining,
      limit.resetTime
    )
  } catch (error) {
    console.error('Link preview API error:', error)
    return ApiError.internalServerError('Internal server error').toNextResponse()
  }
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
