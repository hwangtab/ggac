import { NextRequest } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { timingSafeEqual } from 'crypto'

// 보호: DEPLOY_HOOK_SECRET 헤더 검증 (프로덕션에서는 필수)
// 시크릿은 반드시 x-deploy-secret 헤더로만 전달해야 합니다.
// 쿼리 파라미터 전달은 서버/프록시 로그에 시크릿이 노출될 수 있어 허용하지 않습니다.
function validateSecret(req: NextRequest): boolean {
  const required = process.env.DEPLOY_HOOK_SECRET
  if (!required) {
    // 프로덕션에서는 시크릿 미설정 시 차단
    if (process.env.NODE_ENV === 'production') return false
    return true
  }
  const provided = req.headers.get('x-deploy-secret')
  if (!provided) return false

  // 타이밍 공격 방지를 위한 상수 시간 비교
  try {
    const reqBuf = Buffer.from(provided)
    const secretBuf = Buffer.from(required)
    if (reqBuf.length !== secretBuf.length) return false
    return timingSafeEqual(reqBuf, secretBuf)
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  if (!validateSecret(req)) {
    return ApiError.unauthorized('Unauthorized').toNextResponse()
  }

  const vercelDeployUrl = process.env.VERCEL_DEPLOY_HOOK_URL
  if (!vercelDeployUrl) {
    return ApiError.internalServerError('VERCEL_DEPLOY_HOOK_URL is not configured').toNextResponse()
  }

  try {
    const res = await fetch(vercelDeployUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error('[API] Deploy trigger failed:', res.status, text)
      return ApiError.internalServerError('Deploy trigger failed').toNextResponse()
    }

    return ApiSuccess.ok({ message: 'Deploy triggered' }).toNextResponse()
  } catch (error) {
    console.error('[API] 배포 훅 오류:', error)
    return ApiError.internalServerError('Internal server error').toNextResponse()
  }
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
