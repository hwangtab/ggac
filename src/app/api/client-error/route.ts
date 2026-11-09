import { NextRequest } from 'next/server'
import { ApiSuccess, ApiError } from '@/utils/apiWrapper'
import { createLogger } from '@/utils/logger'
import distLimiter from '@/lib/server/rateLimit'
import {
  BodyTooLargeError,
  boundedString,
  maskIp,
  readBoundedText,
} from '@/lib/server/telemetryIntake'

const MAX_BODY_BYTES = 32 * 1024

const log = createLogger('api/client-error')

const MAX_FIELD_LENGTH = 4096
const MAX_MESSAGE_LENGTH = 1024

function sanitizeClientErrorUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'unknown'

  try {
    const parsed = new URL(value)
    return `${parsed.origin}${parsed.pathname}`.slice(0, 512)
  } catch {
    return 'unknown'
  }
}

async function parseJsonBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body = JSON.parse(await readBoundedText(request, MAX_BODY_BYTES))
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null
  } catch (error) {
    if (error instanceof BodyTooLargeError) throw error
    return null
  }
}

export async function POST(request: NextRequest) {
  const limiter = await distLimiter.applyRateLimit({
    ...distLimiter.CONFIGS.GENERAL_API,
    name: 'client_error',
    maxRequests: 30,
    keyGenerator: distLimiter.createIPKeyGenerator('client_error'),
  })
  const limited = await limiter(request)
  if (!limited.success && limited.response) return limited.response

  try {
    const body = await parseJsonBody(request)

    if (!body?.message || !body.timestamp) {
      return ApiError.badRequest('Missing required fields: message, timestamp').toNextResponse()
    }

    const message = boundedString(body.message, MAX_MESSAGE_LENGTH)
    const stack = body.stack ? boundedString(body.stack, MAX_FIELD_LENGTH) : undefined
    const componentStack = body.componentStack
      ? boundedString(body.componentStack, MAX_FIELD_LENGTH)
      : undefined
    const url = sanitizeClientErrorUrl(body.url)

    const errorLog = {
      timestamp: boundedString(body.timestamp, 64),
      url,
      message,
      stack,
      componentStack,
      userAgent: boundedString(request.headers.get('user-agent'), 200),
      ip: maskIp(request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip')),
      errorId: body.errorId ? boundedString(body.errorId, 64) : `client_error_${Date.now()}`,
      level: 'error',
      source: 'client',
    }

    log.error('Client Error Logged', {
      errorId: errorLog.errorId,
      url: errorLog.url,
      message: errorLog.message,
      timestamp: errorLog.timestamp,
    })

    if (process.env.NODE_ENV === 'development') {
      log.debug('Full Error Details', errorLog)
    }

    return ApiSuccess.ok({
      logged: true,
      errorId: errorLog.errorId,
    }).toNextResponse()
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return new ApiError('Report too large', 413, 'PAYLOAD_TOO_LARGE').toNextResponse()
    }
    log.error('Failed to log client error', error)
    return ApiError.internalServerError('Failed to log client error').toNextResponse()
  }
}

export async function GET() {
  return ApiError.methodNotAllowed('Only POST requests are allowed').toNextResponse()
}

export async function PUT() {
  return ApiError.methodNotAllowed('Only POST requests are allowed').toNextResponse()
}

export async function DELETE() {
  return ApiError.methodNotAllowed('Only POST requests are allowed').toNextResponse()
}
