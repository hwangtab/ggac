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

type ApiRouteAuthMode = 'admin' | 'board-member'
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
  auth?: ApiRouteAuthMode | ApiRouteAuthResolver<TAuth>
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
  if (!auth) return undefined

  if (typeof auth === 'function') {
    return auth({ request, params })
  }

  if (auth === 'admin') {
    return requireAdmin()
  }

  return requireBoardMember()
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
