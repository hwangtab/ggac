import { headers } from 'next/headers'
import { auth } from '@/lib/auth/server'
import { createLogger } from '@/utils/logger'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'

const log = createLogger('api/auth/logout')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    // returnHeaders로 Set-Cookie(세션 쿠키 삭제)를 받아 응답에 직접 실어야
    // 브라우저 쿠키가 실제로 지워진다(member-signup 라우트와 같은 패턴 —
    // node_modules/better-call/dist/endpoint.mjs 실측).
    const { headers: signOutHeaders } = await auth.api.signOut({
      headers: await headers(),
      returnHeaders: true,
    })

    const response = ApiSuccess.ok({}).toNextResponse()
    signOutHeaders.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        response.headers.append('set-cookie', value)
      }
    })
    return response
  } catch (error) {
    log.error('Unexpected logout error', error)
    return ApiError.internalServerError('Internal server error').toNextResponse()
  }
}
