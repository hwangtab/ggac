import { NextResponse, type NextRequest } from 'next/server'
import {
  RATE_LIMITS,
  addRateLimitHeaders,
  applyRouteRateLimit,
  type RateLimitResult,
  type RouteRateLimitConfig,
} from '@/lib/server/rateLimit'
import { requireAdmin, type AdminAuthSuccess } from '@/lib/server/adminAuth'
import { requireBoardMember, type BoardAuthSuccess } from '@/lib/server/boardRoomAuth'
import { createErrorResponse } from '@/utils/apiResponse'
import { ApiError, ApiSuccess } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'
import { parseJsonObjectBody } from '@/utils/requestBody'

const log = createLogger('apiRoute')

type RouteParams = Record<string, string | string[]>
type NextRouteContext = {
  params?: RouteParams | Promise<RouteParams>
}

/**
 * `'public'`은 "인가 게이트가 없다"를 **명시적으로** 선언하는 값이다.
 *
 * 예전에는 `auth`가 optional이라 빠뜨리면 게이트 없이, 경고 없이 통과했다
 * (`if (!auth) return undefined`). Postgres RLS가 사라져 앱 코드가 유일한
 * 경계가 된 지금, 기본값이 열림인 게 가장 위험한 자리다 — 새 admin 라우트를
 * 하나 추가하며 `auth` 한 줄을 빠뜨리는 것만으로 조합원 전원에게 관리자
 * 표면이 열린다. 그래서 `auth`를 필수 필드로 만들고(아래
 * `DefineApiRouteConfig`), 게이트가 없는 라우트는 그 사실을 값으로 적게 했다.
 *
 * 특권 트리(`src/app/api/admin/**`, `src/app/api/board-room/**`)에서는
 * `'public'`도 사고이므로 `scripts/testing/assert-runtime-risks.mjs`의 특권
 * 라우트 가드가 그 트리에 한해 이 값을 거부한다. 타입은 "빠뜨림"을, 가드는
 * "그 자리에 부적절한 값"과 "이 프레임워크를 아예 안 쓰는 맨몸 핸들러"를
 * 각각 막는다 — 타입만으로는 후자를 잡을 수 없다.
 */
type ApiRouteAuthMode = 'admin' | 'board-member' | 'public'
type ApiRouteAuthResult = AdminAuthSuccess | BoardAuthSuccess | undefined
type ApiRouteAuthResolver<TAuth> = (ctx: {
  request: NextRequest
  params: RouteParams
}) => Promise<TAuth | NextResponse>

type BodySchema<TBody> = {
  safeParse: (input: unknown) =>
    | {
        success: true
        data: TBody
      }
    | {
        success: false
      }
}

type BodyConfig<TBody> = {
  required?: boolean
  schema?: BodySchema<TBody>
  invalidMessage?: string
  invalidResponse?: () => NextResponse
}

export type ApiRouteContext<TBody, TAuth> = {
  request: NextRequest
  params: RouteParams
  body: TBody
  auth: TAuth
  rateLimit?: RateLimitResult
}

export type DefineApiRouteConfig<TBody, TAuth, TResult> = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  name: string
  rateLimit?: RouteRateLimitConfig
  rateLimitHeaders?: boolean
  /** 필수다 — 게이트가 없는 라우트도 `'public'`으로 그 사실을 적어야 한다. */
  auth: ApiRouteAuthMode | ApiRouteAuthResolver<TAuth>
  body?: BodyConfig<TBody>
  successStatus?: number
  errorMessage?: string
  errorResponse?: (error: unknown) => NextResponse
  handler: (
    ctx: ApiRouteContext<TBody, TAuth>
  ) => Promise<TResult | ApiSuccess<TResult> | NextResponse>
}

async function resolveRouteParams(context?: NextRouteContext): Promise<RouteParams> {
  const params = context?.params
  return params ? await params : {}
}

async function resolveRouteAuth<TAuth>(
  auth: DefineApiRouteConfig<unknown, TAuth, unknown>['auth'],
  request: NextRequest,
  params: RouteParams
): Promise<TAuth | ApiRouteAuthResult | NextResponse> {
  if (typeof auth === 'function') {
    return auth({ request, params })
  }

  if (auth === 'admin') {
    return requireAdmin()
  }

  if (auth === 'board-member') {
    return requireBoardMember()
  }

  if (auth === 'public') {
    return undefined
  }

  // 여기 오는 유일한 길은 타입을 우회한 호출(누락·오타)이다. 예전에는
  // 그 경우가 `if (!auth) return undefined`로 흡수돼 **게이트 없이 통과**했다.
  // 이제는 열지 않고 막는다 — defineApiRoute의 catch가 500으로 바꾼다.
  throw ApiError.internalServerError('라우트 인가 설정이 올바르지 않습니다.')
}

async function resolveRouteBody<TBody>(
  request: NextRequest,
  bodyConfig?: BodyConfig<TBody>
): Promise<TBody | undefined | NextResponse> {
  if (!bodyConfig) return undefined

  const rawBody = await parseJsonObjectBody(request)
  const invalidMessage = bodyConfig.invalidMessage ?? '유효한 JSON body가 필요합니다.'

  if (!rawBody) {
    if (bodyConfig.required !== false) {
      if (bodyConfig.invalidResponse) {
        return bodyConfig.invalidResponse()
      }
      throw ApiError.badRequest(invalidMessage)
    }
    return undefined
  }

  if (!bodyConfig.schema) {
    return rawBody as TBody
  }

  const parsed = bodyConfig.schema.safeParse(rawBody)
  if (!parsed.success) {
    if (bodyConfig.invalidResponse) {
      return bodyConfig.invalidResponse()
    }
    throw ApiError.badRequest(invalidMessage)
  }

  return parsed.data
}

function normalizeRouteResult<TResult>(
  result: TResult | ApiSuccess<TResult> | NextResponse | undefined,
  successStatus?: number
): NextResponse {
  if (result instanceof NextResponse) {
    return result
  }

  if (result instanceof ApiSuccess) {
    return result.toNextResponse({ successStatus })
  }

  if (result === undefined) {
    return new NextResponse(null, { status: 204 })
  }

  return successStatus
    ? NextResponse.json(result, { status: successStatus })
    : NextResponse.json(result)
}

export function defineApiRoute<TBody = undefined, TAuth = ApiRouteAuthResult, TResult = unknown>(
  config: DefineApiRouteConfig<TBody, TAuth, TResult>
) {
  return async (request: NextRequest, context?: NextRouteContext): Promise<NextResponse> => {
    const params = await resolveRouteParams(context)
    let rateLimitResult: RateLimitResult | undefined

    try {
      if (config.rateLimit) {
        rateLimitResult = await applyRouteRateLimit(request, config.rateLimit)

        if (!rateLimitResult.success) {
          return (
            rateLimitResult.response ??
            ApiError.tooManyRequests(config.rateLimit.message).toNextResponse()
          )
        }
      }

      const auth = await resolveRouteAuth(config.auth, request, params)
      if (auth instanceof NextResponse) {
        return auth
      }

      const body = await resolveRouteBody(request, config.body)
      if (body instanceof NextResponse) {
        return body
      }

      const result = await config.handler({
        request,
        params,
        body: body as TBody,
        auth: auth as TAuth,
        rateLimit: rateLimitResult,
      })

      const response = normalizeRouteResult(result, config.successStatus)

      if (config.rateLimitHeaders && config.rateLimit && rateLimitResult && response.status < 400) {
        return addRateLimitHeaders(
          response,
          config.rateLimit.maxRequests,
          rateLimitResult.remaining,
          rateLimitResult.resetTime
        )
      }

      return response
    } catch (error) {
      if (error instanceof ApiError) {
        return error.toNextResponse()
      }

      log.error('API route failed', {
        name: config.name,
        method: config.method,
        error,
      })

      if (config.errorResponse) {
        return config.errorResponse(error)
      }

      return createErrorResponse(
        { success: false, error: config.errorMessage ?? '서버 오류가 발생했습니다.' },
        500
      )
    }
  }
}

export { RATE_LIMITS }
